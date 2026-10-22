import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  priceDesign,
  renderHatSvg,
  validateDesign,
  type CustomCatalog,
  type CustomOptions,
  type DesignAssetDto,
  type DesignContent,
  type DesignDto,
  type DesignVersionDto,
  type LayerInput,
  type OrderCustomization,
  type RenderExtras,
  type AssetStatus,
} from '@nona/contracts';
import type pg from 'pg';
import sharp from 'sharp';
import { AppError } from '../../../common/errors/app-error';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { availableQtySql } from '../../inventory/infrastructure/availability';
import { ImageProcessor } from '../../media/application/image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from '../../media/domain';
import { SettingsService } from '../../settings/application/settings.service';
import {
  DesignsRepository,
  hashGuest,
  type AssetRow,
  type DesignOwner,
  type DesignRow,
  type LayerRow,
  type VersionRow,
} from '../infrastructure/designs.repository';
import { PreviewRenderer } from '../infrastructure/preview-renderer';

export const MAX_ASSETS_PER_OWNER = 10;
export type Viewer = { kind: 'owner'; owner: DesignOwner } | { kind: 'staff' };

const invalid = (issues: string[]) =>
  new AppError('DESIGN_INVALID', 400, 'Thiết kế chưa hợp lệ.', {
    issues: issues.map((message) => ({ path: 'design', message })),
  });

@Injectable()
export class DesignsService {
  private readonly mediaBase: string;
  constructor(
    @Inject(DesignsRepository) private readonly repo: DesignsRepository,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(PreviewRenderer) private readonly renderer: PreviewRenderer,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  // ---- public catalogue ----------------------------------------------------------------------------

  async catalog(): Promise<CustomCatalog> {
    const options = await this.settings.getCustomOptions();
    const { rows } = await this.db.query(
      `SELECT p.id, p.slug, p.name, p.hat_width_cm, p.hat_height_cm,
              (SELECT object_key FROM product_images WHERE product_id = p.id ORDER BY (variant_id IS NOT NULL), position, created_at LIMIT 1) AS image_key
       FROM products p WHERE p.status = 'PUBLISHED' AND p.is_customizable ORDER BY p.sort_weight DESC, p.name`,
    );
    const products: CustomCatalog['products'] = [];
    for (const p of rows) {
      const v = await this.db.query(
        `SELECT v.id, v.name, v.price_vnd, ${availableQtySql('v')} AS available,
                img.object_key AS image_key, img.width AS image_width, img.height AS image_height
         FROM product_variants v
         LEFT JOIN LATERAL (
           SELECT object_key, width, height FROM product_images
           WHERE product_id = v.product_id AND (variant_id = v.id OR variant_id IS NULL)
           ORDER BY (variant_id IS NULL), position, created_at LIMIT 1) img ON true
         WHERE v.product_id = $1 AND v.is_active ORDER BY v.position, v.created_at`,
        [p.id],
      );
      if (!v.rows.length) continue;
      products.push({
        slug: p.slug,
        name: p.name,
        imageUrl: p.image_key ? `${this.mediaBase}/${p.image_key}` : null,
        hatWidthCm: p.hat_width_cm === null ? null : Number(p.hat_width_cm),
        hatHeightCm: p.hat_height_cm === null ? null : Number(p.hat_height_cm),
        variants: v.rows.map((r) => ({
          id: r.id,
          name: r.name,
          priceVnd: Number(r.price_vnd),
          availability:
            r.available <= 0 ? 'OUT_OF_STOCK' : r.available <= 5 ? 'LOW_STOCK' : 'IN_STOCK',
          image: r.image_key
            ? {
                url: `${this.mediaBase}/${r.image_key}`,
                width: r.image_width,
                height: r.image_height,
              }
            : null,
        })),
      });
    }
    return { options, mediaBase: this.mediaBase, products };
  }

  /**
   * The SVG rasteriser (librsvg) cannot decode WebP, so every picture is handed to it as an inline PNG.
   * Pictures are small by construction (hat <= 1000px, charm 256px, customer upload <= 1200px).
   */
  private async dataUri(key: string): Promise<string | null> {
    const obj = await this.storage.get(key);
    if (!obj) return null;
    const png = await sharp(obj.body).png().toBuffer();
    return `data:image/png;base64,${png.toString('base64')}`;
  }

  /** Pictures the renderer needs besides uploaded layers: the shop's hat picture and any picture charms used. */
  private async renderExtras(
    content: Pick<DesignContent, 'layers'>,
    options: CustomOptions,
    baseImage: { key: string; width: number; height: number } | null,
    hatWidthCm: number | null,
    hatHeightCm: number | null,
  ): Promise<RenderExtras> {
    const hatHref = baseImage ? await this.dataUri(baseImage.key) : null;
    const hrefs = new Map<string, string>();
    for (const l of content.layers) {
      if (l.kind !== 'MOTIF') continue;
      const key = options.motifs.find((m) => m.id === l.motifId)?.imageKey;
      if (key && !hrefs.has(key)) {
        const uri = await this.dataUri(key);
        if (uri) hrefs.set(key, uri);
      }
    }
    return {
      hat:
        baseImage && hatHref
          ? { href: hatHref, width: baseImage.width, height: baseImage.height }
          : null,
      hatWidthCm,
      hatHeightCm,
      motifHref: (k) => hrefs.get(k) ?? null,
    };
  }

  // ---- helpers -------------------------------------------------------------------------------------

  private async requireBase(variantId: string) {
    const base = await this.repo.baseVariant(this.db.pool, variantId);
    if (!base || !base.active || !base.published || !base.customizable)
      throw invalid(['Sản phẩm này không hỗ trợ thiết kế riêng']);
    return base;
  }

  private async requireOwnedAssets(
    owner: DesignOwner,
    layers: LayerInput[],
  ): Promise<Map<string, AssetRow>> {
    const ids = [...new Set(layers.flatMap((l) => (l.kind === 'IMAGE' ? [l.assetId] : [])))];
    const assets = await this.repo.assetsByIds(this.db.pool, ids);
    const map = new Map(assets.map((a) => [a.id, a]));
    for (const id of ids) {
      const a = map.get(id);
      if (!a || !this.repo.ownedBy(a, owner))
        throw invalid(['Ảnh đã tải lên không tồn tại hoặc không thuộc về bạn']); // same answer: do not reveal other people's assets
    }
    return map;
  }

  private authorize(row: DesignRow, viewer: Viewer) {
    if (viewer.kind === 'owner' && !this.repo.ownedBy(row, viewer.owner))
      throw AppError.notFound('Không tìm thấy thiết kế.'); // 404, not 403: existence is not revealed
  }

  private async loadDesign(id: string, viewer: Viewer): Promise<DesignRow> {
    const row = await this.repo.design(this.db.pool, id);
    if (!row) throw AppError.notFound('Không tìm thấy thiết kế.');
    this.authorize(row, viewer);
    return row;
  }

  private layerDto(l: LayerRow) {
    return {
      id: l.id,
      position: l.position,
      kind: l.kind,
      text: l.props.text ?? null,
      fontId: l.props.fontId ?? null,
      motifId: l.props.motifId ?? null,
      assetId: l.asset_id,
      x: Number(l.x),
      y: Number(l.y),
      scale: Number(l.scale),
      rotation: Number(l.rotation),
    };
  }

  private versionDto(v: VersionRow, layers: LayerRow[]): DesignVersionDto {
    return {
      id: v.id,
      versionNo: v.version_no,
      status: v.status as DesignVersionDto['status'],
      variantId: v.variant_id,
      layers: layers.map((l) => this.layerDto(l)),
      priceAdditionVnd: v.status === 'DRAFT' ? null : Number(v.price_addition_vnd),
      hasPreview: Boolean(v.preview_key),
      submittedAt: v.submitted_at?.toISOString() ?? null,
      reviewedAt: v.reviewed_at?.toISOString() ?? null,
      reviewNote: v.review_note,
      createdAt: v.created_at.toISOString(),
    };
  }

  private assetDto(a: AssetRow): DesignAssetDto {
    return {
      id: a.id,
      status: a.status,
      width: a.width,
      height: a.height,
      reviewNote: a.review_note,
      createdAt: a.created_at.toISOString(),
    };
  }

  async toDto(row: DesignRow, versionId?: string): Promise<DesignDto> {
    const versions = await this.repo.versions(this.db.pool, row.id);
    const latest =
      (versionId ? versions.find((v) => v.id === versionId) : undefined) ??
      versions[versions.length - 1]!;
    const layers = await this.repo.layers(this.db.pool, latest.id);
    const base = (await this.repo.baseVariant(this.db.pool, latest.variant_id))!;
    const assets = await this.repo.assetsByIds(
      this.db.pool,
      layers.flatMap((l) => (l.asset_id ? [l.asset_id] : [])),
    );
    return {
      id: row.id,
      title: row.title,
      contactEmail: row.contact_email,
      updatedAt: row.updated_at.toISOString(),
      product: {
        slug: base.slug,
        name: base.productName,
        variantName: base.variantName,
        basePriceVnd: base.priceVnd,
        imageUrl: base.imageKey ? `${this.mediaBase}/${base.imageKey}` : null,
      },
      latest: this.versionDto(latest, layers),
      versions: versions.map((v) => ({
        id: v.id,
        versionNo: v.version_no,
        status: v.status as DesignVersionDto['status'],
        createdAt: v.created_at.toISOString(),
      })),
      assets: assets.map((a) => this.assetDto(a)),
    };
  }

  /** Draft content as the shared validators see it (used by save and submit). */
  private content(row: DesignRow, v: VersionRow, layers: LayerRow[]): DesignContent {
    return {
      title: row.title,
      variantId: v.variant_id,
      layers: this.repo.layerInputs(layers),
    };
  }

  private assertValid(
    content: DesignContent,
    options: CustomOptions,
    assets: Map<string, AssetRow>,
  ) {
    const issues = validateDesign(
      content,
      options,
      (id) => (assets.get(id)?.status as AssetStatus | undefined) ?? null,
    );
    if (issues.length) throw invalid(issues);
  }

  // ---- customer operations ------------------------------------------------------------------------

  async create(
    owner: DesignOwner,
    input: DesignContent & { contactEmail?: string },
    quota: { allowed: boolean },
  ): Promise<DesignDto> {
    if (!quota.allowed)
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn tạo thiết kế quá nhiều lần. Vui lòng thử lại sau.',
      );
    const options = await this.settings.getCustomOptions();
    if (!options.enabled)
      throw new AppError('CONFLICT', 409, 'Tính năng thiết kế riêng đang tạm đóng.');
    await this.requireBase(input.variantId);
    const assets = await this.requireOwnedAssets(owner, input.layers);
    this.assertValid(input, options, assets);
    const id = await this.db.transaction(async (c) => {
      const designId = await this.repo.insertDesign(
        c,
        owner,
        input.title,
        input.contactEmail ?? null,
      );
      const versionId = await this.repo.insertVersion(c, designId, 1, input.variantId);
      await this.repo.replaceLayers(c, versionId, input.layers);
      return designId;
    });
    return this.toDto((await this.repo.design(this.db.pool, id))!);
  }

  async get(id: string, viewer: Viewer, versionId?: string): Promise<DesignDto> {
    return this.toDto(await this.loadDesign(id, viewer), versionId);
  }

  async listMine(owner: DesignOwner) {
    const [userId, guest] = this.repo.ownerParams(owner);
    const { rows } = await this.db.query(
      `SELECT d.id, d.title, d.updated_at, v.id AS version_id, v.version_no, v.status, v.preview_key, p.name AS product_name
       FROM custom_designs d
       JOIN LATERAL (SELECT * FROM custom_design_versions WHERE design_id = d.id ORDER BY version_no DESC LIMIT 1) v ON true
       JOIN product_variants pv ON pv.id = v.variant_id JOIN products p ON p.id = pv.product_id
       WHERE ($1::uuid IS NOT NULL AND d.user_id = $1) OR ($2::text IS NOT NULL AND d.guest_token_hash = $2)
       ORDER BY d.updated_at DESC LIMIT 50`,
      [userId, guest],
    );
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        title: r.title as string,
        status: r.status as DesignVersionDto['status'],
        versionId: r.version_id as string,
        versionNo: r.version_no as number,
        hasPreview: Boolean(r.preview_key),
        productName: r.product_name as string,
        updatedAt: (r.updated_at as Date).toISOString(),
        canOrder: r.status === 'SUBMITTED' || r.status === 'APPROVED',
      })),
    };
  }

  /** Edits the DRAFT version in place. Submitted versions are frozen; create a new version to change them. */
  async update(
    id: string,
    owner: DesignOwner,
    patch: Partial<DesignContent> & { contactEmail?: string | null },
  ): Promise<DesignDto> {
    const options = await this.settings.getCustomOptions();
    await this.db.transaction(async (c) => {
      const row = await this.repo.design(c, id, true);
      if (!row) throw AppError.notFound('Không tìm thấy thiết kế.');
      this.authorize(row, { kind: 'owner', owner });
      const versions = await this.repo.versions(c, id);
      const latest = versions[versions.length - 1]!;
      if (latest.status !== 'DRAFT')
        throw new AppError(
          'CONFLICT',
          409,
          'Phiên bản này đã được nộp nên không thể sửa. Hãy tạo phiên bản mới.',
          { status: latest.status },
        );
      const layersRows = await this.repo.layers(c, latest.id);
      const merged: DesignContent = {
        title: patch.title ?? row.title,
        variantId: patch.variantId ?? latest.variant_id,
        layers: patch.layers ?? this.repo.layerInputs(layersRows),
      };
      if (patch.variantId) {
        const base = await this.repo.baseVariant(c, patch.variantId);
        if (!base || !base.active || !base.published || !base.customizable)
          throw invalid(['Sản phẩm này không hỗ trợ thiết kế riêng']);
      }
      const assets = await this.requireOwnedAssets(owner, merged.layers);
      this.assertValid(merged, options, assets);
      await c.query(
        'UPDATE custom_designs SET title = $2, contact_email = COALESCE($3, contact_email), updated_at = now() WHERE id = $1',
        [id, merged.title, patch.contactEmail ?? null],
      );
      await c.query(
        'UPDATE custom_design_versions SET variant_id = $2, updated_at = now() WHERE id = $1',
        [latest.id, merged.variantId],
      );
      if (patch.layers) await this.repo.replaceLayers(c, latest.id, merged.layers);
    });
    return this.get(id, { kind: 'owner', owner });
  }

  /** Starts the next version from the latest one. Earlier approved versions stay valid; a version that needed changes is archived. */
  async newVersion(id: string, owner: DesignOwner): Promise<DesignDto> {
    await this.db.transaction(async (c) => {
      const row = await this.repo.design(c, id, true);
      if (!row) throw AppError.notFound('Không tìm thấy thiết kế.');
      this.authorize(row, { kind: 'owner', owner });
      const versions = await this.repo.versions(c, id);
      const latest = versions[versions.length - 1]!;
      if (latest.status === 'DRAFT') return; // already editable
      if (latest.status === 'SUBMITTED')
        throw new AppError('CONFLICT', 409, 'Thiết kế đang chờ duyệt, chưa thể tạo phiên bản mới.');
      const nextId = await this.repo.insertVersion(c, id, latest.version_no + 1, latest.variant_id);
      await this.repo.copyLayers(c, latest.id, nextId);
      if (latest.status === 'REVISION_REQUIRED')
        await c.query(
          `UPDATE custom_design_versions SET status = 'ARCHIVED', updated_at = now() WHERE id = $1`,
          [latest.id],
        );
      await c.query('UPDATE custom_designs SET updated_at = now() WHERE id = $1', [id]);
    });
    return this.get(id, { kind: 'owner', owner });
  }

  /**
   * Freezes the draft: validates it, computes the authoritative price addition from the current admin
   * options, renders and stores the preview, then submits (and auto-approves only when approval is not
   * required AND no uploaded image is still waiting for moderation).
   */
  async submit(id: string, owner: DesignOwner, contactEmail?: string): Promise<DesignDto> {
    const options = await this.settings.getCustomOptions();
    if (!options.enabled)
      throw new AppError('CONFLICT', 409, 'Tính năng thiết kế riêng đang tạm đóng.');
    const row = await this.loadDesign(id, { kind: 'owner', owner });
    const versions = await this.repo.versions(this.db.pool, id);
    const latest = versions[versions.length - 1]!;
    if (latest.status !== 'DRAFT')
      throw new AppError('CONFLICT', 409, 'Phiên bản này đã được nộp.', { status: latest.status });
    const email = contactEmail ?? row.contact_email;

    const layersRows = await this.repo.layers(this.db.pool, latest.id);
    const content = this.content(row, latest, layersRows);
    const base = await this.requireBase(content.variantId);
    const assets = await this.requireOwnedAssets(owner, content.layers);
    this.assertValid(content, options, assets);
    const price = priceDesign(content, options);

    // Preview is rendered server-side from the same pure function the editor uses.
    const hrefs = new Map<string, string>();
    for (const a of assets.values()) {
      const uri = await this.dataUri(a.object_key);
      if (uri) hrefs.set(a.id, uri);
    }
    const png = await this.renderer.toPng(
      renderHatSvg(
        content,
        options,
        (aid) => hrefs.get(aid) ?? null,
        'p',
        await this.renderExtras(
          content,
          options,
          base.baseImage,
          base.hatWidthCm,
          base.hatHeightCm,
        ),
      ),
    );
    const previewKey = `designs/${id}/${latest.version_no}-${randomUUID()}.png`;
    await this.storage.put(previewKey, png, 'image/png');

    // With approval switched off (the default) a submitted design is accepted as is, including the pictures the
    // customer uploaded; with it on, staff review both before production.
    const autoApprove = !options.requireApproval;
    try {
      await this.db.transaction(async (c) => {
        const cur = await this.repo.version(c, latest.id, true);
        if (!cur || cur.status !== 'DRAFT')
          throw new AppError('CONFLICT', 409, 'Phiên bản này đã được nộp.');
        await c.query(
          `UPDATE custom_design_versions SET status = 'SUBMITTED', price_addition_vnd = $2, preview_key = $3, submitted_at = now(), updated_at = now() WHERE id = $1`,
          [latest.id, price.totalVnd, previewKey],
        );
        if (autoApprove) {
          await c.query(
            `UPDATE custom_design_versions SET status = 'APPROVED', reviewed_at = now(), review_note = 'Tự động duyệt theo cấu hình cửa hàng', updated_at = now() WHERE id = $1`,
            [latest.id],
          );
          const used = [...assets.keys()];
          if (used.length)
            await c.query(
              `UPDATE design_assets SET status = 'APPROVED', reviewed_at = now() WHERE id = ANY($1::uuid[]) AND status = 'PENDING'`,
              [used],
            );
        }
        await c.query(
          'UPDATE custom_designs SET contact_email = COALESCE($2, contact_email), updated_at = now() WHERE id = $1',
          [id, email ?? null],
        );
      });
    } catch (error) {
      await this.storage.delete(previewKey).catch(() => undefined); // do not orphan the preview if the DB step failed
      throw error;
    }
    return this.get(id, { kind: 'owner', owner });
  }

  // ---- uploads & files ------------------------------------------------------------------------------

  async uploadAsset(owner: DesignOwner, file: Buffer, allowed: boolean): Promise<DesignAssetDto> {
    if (!allowed)
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn tải ảnh quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    const [userId, guest] = this.repo.ownerParams(owner);
    const count = Number(
      (
        await this.db.query(
          `SELECT COUNT(*) AS n FROM design_assets WHERE ($1::uuid IS NOT NULL AND user_id = $1) OR ($2::text IS NOT NULL AND guest_token_hash = $2)`,
          [userId, guest],
        )
      ).rows[0]!.n,
    );
    if (count >= MAX_ASSETS_PER_OWNER)
      throw new AppError(
        'CONFLICT',
        409,
        `Bạn chỉ có thể tải lên tối đa ${MAX_ASSETS_PER_OWNER} ảnh.`,
      );
    const processed = await this.images.process(file, { minSide: 200, maxSide: 1200 });
    const key = `designs/assets/${randomUUID()}.webp`;
    await this.storage.put(key, processed.body, processed.contentType);
    try {
      const { rows } = await this.db.query(
        'INSERT INTO design_assets (user_id, guest_token_hash, object_key, width, height) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [userId, guest, key, processed.width, processed.height],
      );
      return this.assetDto(rows[0] as AssetRow);
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  /** Controlled streaming of a private upload: only its owner or staff who may read designs. */
  async assetContent(assetId: string, viewer: Viewer) {
    const a = await this.repo.asset(this.db.pool, assetId);
    if (!a || (viewer.kind === 'owner' && !this.repo.ownedBy(a, viewer.owner)))
      throw AppError.notFound('Không tìm thấy ảnh.');
    const obj = await this.storage.get(a.object_key);
    if (!obj) throw AppError.notFound('Không tìm thấy ảnh.');
    return obj;
  }

  async previewContent(versionId: string, viewer: Viewer) {
    const v = await this.repo.version(this.db.pool, versionId);
    if (!v?.preview_key) throw AppError.notFound('Không tìm thấy bản xem trước.');
    const d = (await this.repo.design(this.db.pool, v.design_id))!;
    this.authorize(d, viewer);
    const obj = await this.storage.get(v.preview_key);
    if (!obj) throw AppError.notFound('Không tìm thấy bản xem trước.');
    return obj;
  }

  /** Signing in: designs (and uploads) made as a guest become the account's. */
  async mergeGuest(userId: string, guestToken: string): Promise<void> {
    const hash = hashGuest(guestToken);
    await this.db.transaction(async (c) => {
      await c.query(
        'UPDATE custom_designs SET user_id = $1, guest_token_hash = NULL WHERE guest_token_hash = $2',
        [userId, hash],
      );
      await c.query(
        'UPDATE design_assets SET user_id = $1, guest_token_hash = NULL WHERE guest_token_hash = $2',
        [userId, hash],
      );
    });
  }

  newGuestToken(): string {
    return randomBytes(32).toString('base64url');
  }

  // ---- ordering ------------------------------------------------------------------------------------

  /**
   * A version may go into a cart only if the viewer owns it, it matches the chosen base variant and it
   * is APPROVED. Returns the frozen price addition.
   */
  async assertOrderable(
    versionId: string,
    variantId: string,
    owner: DesignOwner | null,
  ): Promise<{ priceAdditionVnd: number; title: string }> {
    const v = await this.repo.version(this.db.pool, versionId);
    if (!v) throw AppError.notFound('Không tìm thấy thiết kế.');
    const d = (await this.repo.design(this.db.pool, v.design_id))!;
    if (!owner || !this.repo.ownedBy(d, owner)) throw AppError.notFound('Không tìm thấy thiết kế.');
    if (v.variant_id !== variantId)
      throw invalid(['Thiết kế này được tạo cho một phiên bản sản phẩm khác']);
    // Ordering is allowed as soon as the design is submitted (frozen); staff approval is required before production.
    if (v.status !== 'SUBMITTED' && v.status !== 'APPROVED')
      throw new AppError('DESIGN_NOT_APPROVED', 409, 'Hãy hoàn tất thiết kế trước khi đặt hàng.', {
        status: v.status,
      });
    return { priceAdditionVnd: Number(v.price_addition_vnd), title: d.title };
  }

  /** Immutable copy written onto the order item. Includes readable names so it never depends on later catalogue edits. */
  async snapshot(
    q: Pick<pg.PoolClient, 'query'>,
    versionId: string,
    orderEmail?: string,
  ): Promise<OrderCustomization> {
    const v = (await q.query('SELECT * FROM custom_design_versions WHERE id = $1', [versionId]))
      .rows[0] as VersionRow;
    const d = (await q.query('SELECT * FROM custom_designs WHERE id = $1', [v.design_id]))
      .rows[0] as DesignRow;
    const layers = (
      await q.query('SELECT * FROM design_layers WHERE version_id = $1 ORDER BY position', [
        versionId,
      ])
    ).rows as LayerRow[];
    // The customer may order without ever giving an email at design time: use the order's, so review notices reach them.
    if (orderEmail && !d.contact_email && !d.user_id)
      await q.query('UPDATE custom_designs SET contact_email = $2 WHERE id = $1', [
        d.id,
        orderEmail,
      ]);
    const options = await this.settings.getCustomOptions(q as never);
    const content = { layers: this.repo.layerInputs(layers) };
    const base = await this.repo.baseVariant(q as never, v.variant_id);
    return {
      designId: d.id,
      versionId: v.id,
      versionNo: v.version_no,
      title: d.title,
      variantName: base?.variantName ?? null,
      hatColor: null,
      layers: content.layers.map((l) => {
        if (l.kind === 'MOTIF') {
          const m = options.motifs.find((x) => x.id === l.motifId);
          const name = m?.name ?? l.motifId;
          return {
            kind: l.kind,
            summary: `Charm ${name} (mã ${l.motifId})`,
            charmCode: l.motifId,
            charmName: name,
          };
        }
        return {
          kind: l.kind,
          summary: l.kind === 'TEXT' ? `Chữ “${l.text}” (${l.fontId})` : 'Ảnh khách tải lên',
          charmCode: null,
          charmName: null,
        };
      }),
      priceAdditionVnd: Number(v.price_addition_vnd),
      priceLines: priceDesign(content, options).lines,
      approvedAt:
        v.status === 'APPROVED' ? ((v.reviewed_at ?? v.submitted_at)?.toISOString() ?? null) : null,
    };
  }

  async notifyReviewed(
    c: pg.PoolClient,
    row: DesignRow,
    version: VersionRow,
    decision: 'APPROVED' | 'REVISION_REQUIRED',
    note: string | null,
  ) {
    let email = row.contact_email;
    if (!email && row.user_id)
      email =
        ((await c.query('SELECT email FROM users WHERE id = $1', [row.user_id])).rows[0]?.email as
          string | undefined) ?? null;
    if (!email) return;
    await enqueueOutbox(c, 'design.reviewed', {
      email,
      designId: row.id,
      designTitle: row.title,
      versionNo: version.version_no,
      decision,
      note,
    });
  }
}
