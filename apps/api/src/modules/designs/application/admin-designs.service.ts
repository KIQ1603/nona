import { Inject, Injectable } from '@nestjs/common';
import { priceDesign, type AdminDesignDetail } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { SettingsService } from '../../settings/application/settings.service';
import { DesignsRepository } from '../infrastructure/designs.repository';
import { DesignsService } from './designs.service';

export interface ReviewInput {
  decision: 'APPROVE' | 'REQUEST_REVISION';
  note?: string;
  rejectAssetIds: string[];
}

@Injectable()
export class AdminDesignsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(DesignsRepository) private readonly repo: DesignsRepository,
    @Inject(DesignsService) private readonly designs: DesignsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Review queue: versions that left DRAFT, oldest submission first so nobody waits indefinitely. */
  async list(filter: { status?: string; q?: string }, page: number, pageSize: number) {
    const where = [`v.status <> 'DRAFT'`];
    const values: unknown[] = [];
    const p = (x: unknown) => (values.push(x), `$${values.length}`);
    if (filter.status) where.push(`v.status = ${p(filter.status)}`);
    if (filter.q) {
      const like = p(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(
        `(unaccent(lower(d.title)) LIKE unaccent(lower(${like})) OR u.email ILIKE ${like} OR d.contact_email ILIKE ${like})`,
      );
    }
    const limit = p(pageSize);
    const offset = p((page - 1) * pageSize);
    const { rows } = await this.db.query(
      `SELECT d.id AS design_id, v.id AS version_id, v.version_no, d.title, v.status, v.submitted_at, v.preview_key, pr.name AS product_name,
              COALESCE(u.email, d.contact_email, 'Khách vãng lai') AS owner, COUNT(*) OVER() AS total
       FROM custom_design_versions v
       JOIN custom_designs d ON d.id = v.design_id
       LEFT JOIN users u ON u.id = d.user_id
       JOIN product_variants pv ON pv.id = v.variant_id JOIN products pr ON pr.id = pv.product_id
       WHERE ${where.join(' AND ')}
       ORDER BY (v.status = 'SUBMITTED') DESC,
                CASE WHEN v.status = 'SUBMITTED' THEN v.submitted_at END ASC NULLS LAST,
                v.submitted_at DESC NULLS LAST, v.id LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return {
      items: rows.map((r) => ({
        designId: r.design_id as string,
        versionId: r.version_id as string,
        versionNo: r.version_no as number,
        title: r.title as string,
        status: r.status,
        owner: r.owner as string,
        productName: r.product_name as string,
        submittedAt: r.submitted_at ? (r.submitted_at as Date).toISOString() : null,
        hasPreview: Boolean(r.preview_key),
      })),
      meta: { page, pageSize, total: rows[0] ? Number(rows[0].total) : 0 },
    };
  }

  async detail(designId: string, versionId?: string): Promise<AdminDesignDetail> {
    const row = await this.repo.design(this.db.pool, designId);
    if (!row) throw AppError.notFound('Không tìm thấy thiết kế.');
    const dto = await this.designs.toDto(row, versionId);
    const options = await this.settings.getCustomOptions();
    const email = row.user_id
      ? ((await this.db.query('SELECT email FROM users WHERE id = $1', [row.user_id])).rows[0]
          ?.email as string | undefined)
      : undefined;
    const layers = await this.repo.layers(this.db.pool, dto.latest.id);
    return {
      ...dto,
      owner: email ?? row.contact_email ?? 'Khách vãng lai',
      ownerKind: row.user_id ? 'ACCOUNT' : 'GUEST',
      priceLines: priceDesign({ layers: this.repo.layerInputs(layers) }, options).lines,
    };
  }

  /** Approving also clears the uploaded images the design uses; requesting changes can reject specific images. */
  async review(
    versionId: string,
    input: ReviewInput,
    actor: { userId: string; requestId?: string },
  ): Promise<AdminDesignDetail> {
    const designId = await this.db.transaction(async (c) => {
      const v = await this.repo.version(c, versionId, true);
      if (!v) throw AppError.notFound('Không tìm thấy phiên bản thiết kế.');
      if (v.status !== 'SUBMITTED')
        throw new AppError('CONFLICT', 409, 'Phiên bản này không ở trạng thái chờ duyệt.', {
          status: v.status,
        });
      const design = (await this.repo.design(c, v.design_id, true))!;
      const layers = await this.repo.layers(c, v.id);
      const assetIds = layers.flatMap((l) => (l.asset_id ? [l.asset_id] : []));
      const assets = await this.repo.assetsByIds(c, assetIds);

      if (input.decision === 'APPROVE') {
        if (input.rejectAssetIds.length)
          throw AppError.validation({
            issues: [
              {
                path: 'rejectAssetIds',
                message: 'Không thể duyệt thiết kế và từ chối ảnh cùng lúc',
              },
            ],
          });
        if (assets.some((a) => a.status === 'REJECTED'))
          throw new AppError('CONFLICT', 409, 'Thiết kế đang dùng ảnh đã bị từ chối.');
        await c.query(
          `UPDATE design_assets SET status = 'APPROVED', reviewed_by = $2, reviewed_at = now() WHERE id = ANY($1::uuid[]) AND status = 'PENDING'`,
          [assetIds, actor.userId],
        );
      } else {
        if (!input.note?.trim())
          throw AppError.validation({
            issues: [
              { path: 'note', message: 'Cần ghi rõ nội dung cần chỉnh sửa để khách biết sửa gì' },
            ],
          });
        if (input.rejectAssetIds.some((id) => !assetIds.includes(id)))
          throw AppError.validation({
            issues: [{ path: 'rejectAssetIds', message: 'Ảnh không thuộc thiết kế này' }],
          });
        await c.query(
          `UPDATE design_assets SET status = 'REJECTED', review_note = $3, reviewed_by = $2, reviewed_at = now() WHERE id = ANY($1::uuid[])`,
          [input.rejectAssetIds, actor.userId, input.note],
        );
      }
      const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REVISION_REQUIRED';
      const note = input.note?.trim() || null;
      const updated = (
        await c.query(
          `UPDATE custom_design_versions SET status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4, updated_at = now() WHERE id = $1 RETURNING *`,
          [v.id, status, actor.userId, note],
        )
      ).rows[0];
      await c.query('UPDATE custom_designs SET updated_at = now() WHERE id = $1', [design.id]);
      await this.audit.record(
        {
          actorId: actor.userId,
          action: input.decision === 'APPROVE' ? 'design.approve' : 'design.request_revision',
          targetType: 'design',
          targetId: design.id,
          metadata: {
            versionId: v.id,
            versionNo: v.version_no,
            title: design.title,
            note,
            rejectedAssets: input.rejectAssetIds,
          },
          requestId: actor.requestId,
        },
        c,
      );
      await this.designs.notifyReviewed(c, design, updated, status, note);
      return design.id;
    });
    return this.detail(designId, versionId);
  }
}
