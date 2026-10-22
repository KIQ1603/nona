import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { LayerInput } from '@nona/contracts';
import type pg from 'pg';
import { DatabaseService } from '../../../platform/database/database.service';
import { availableQtySql } from '../../inventory/infrastructure/availability';

type Q = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;
export type DesignOwner = { userId: string } | { guestToken: string };
export const hashGuest = (token: string) => createHash('sha256').update(token).digest('hex');

export interface DesignRow {
  id: string;
  user_id: string | null;
  guest_token_hash: string | null;
  contact_email: string | null;
  title: string;
  created_at: Date;
  updated_at: Date;
}
export interface VersionRow {
  id: string;
  design_id: string;
  version_no: number;
  variant_id: string;
  hat_color_id: string;
  status: string;
  price_addition_vnd: string;
  preview_key: string | null;
  submitted_at: Date | null;
  reviewed_by: string | null;
  reviewed_at: Date | null;
  review_note: string | null;
  created_at: Date;
}
export interface LayerRow {
  id: string;
  version_id: string;
  position: number;
  kind: 'TEXT' | 'MOTIF' | 'IMAGE';
  props: { text?: string; fontId?: string; motifId?: string };
  asset_id: string | null;
  x: string;
  y: string;
  scale: string;
  rotation: string;
}
export interface AssetRow {
  id: string;
  user_id: string | null;
  guest_token_hash: string | null;
  object_key: string;
  width: number;
  height: number;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  review_note: string | null;
  created_at: Date;
}

@Injectable()
export class DesignsRepository {
  constructor(@Inject(DatabaseService) readonly db: DatabaseService) {}

  ownedBy(
    row: { user_id: string | null; guest_token_hash: string | null },
    owner: DesignOwner,
  ): boolean {
    return 'userId' in owner
      ? row.user_id === owner.userId
      : row.guest_token_hash === hashGuest(owner.guestToken);
  }
  ownerParams(owner: DesignOwner): [string | null, string | null] {
    return 'userId' in owner ? [owner.userId, null] : [null, hashGuest(owner.guestToken)];
  }

  async design(q: Q, id: string, lock = false): Promise<DesignRow | null> {
    return (
      ((
        await q.query(`SELECT * FROM custom_designs WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [
          id,
        ])
      ).rows[0] as DesignRow) ?? null
    );
  }
  async versions(q: Q, designId: string): Promise<VersionRow[]> {
    return (
      await q.query(
        'SELECT * FROM custom_design_versions WHERE design_id = $1 ORDER BY version_no',
        [designId],
      )
    ).rows as VersionRow[];
  }
  async version(q: Q, id: string, lock = false): Promise<VersionRow | null> {
    return (
      ((
        await q.query(
          `SELECT * FROM custom_design_versions WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
          [id],
        )
      ).rows[0] as VersionRow) ?? null
    );
  }
  async layers(q: Q, versionId: string): Promise<LayerRow[]> {
    return (
      await q.query('SELECT * FROM design_layers WHERE version_id = $1 ORDER BY position', [
        versionId,
      ])
    ).rows as LayerRow[];
  }
  async asset(q: Q, id: string): Promise<AssetRow | null> {
    return (
      ((await q.query('SELECT * FROM design_assets WHERE id = $1', [id])).rows[0] as AssetRow) ??
      null
    );
  }
  async assetsByIds(q: Q, ids: string[]): Promise<AssetRow[]> {
    if (!ids.length) return [];
    return (await q.query('SELECT * FROM design_assets WHERE id = ANY($1::uuid[])', [ids]))
      .rows as AssetRow[];
  }

  /** The base variant + product a design is built on, with live availability. */
  async baseVariant(q: Q, variantId: string) {
    const { rows } = await q.query(
      `SELECT v.id, v.name AS variant_name, v.price_vnd, v.is_active, p.slug, p.name AS product_name, (p.status = 'PUBLISHED') AS published, p.is_customizable, p.hat_width_cm, p.hat_height_cm,
              img.object_key AS image_key, img.width AS image_width, img.height AS image_height,
              ${availableQtySql('v')} AS available
       FROM product_variants v JOIN products p ON p.id = v.product_id
       LEFT JOIN LATERAL (
         SELECT object_key, width, height FROM product_images
         WHERE product_id = p.id AND (variant_id = v.id OR variant_id IS NULL)
         ORDER BY (variant_id IS NULL), position, created_at LIMIT 1) img ON true
       WHERE v.id = $1`,
      [variantId],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id as string,
          variantName: r.variant_name as string,
          priceVnd: Number(r.price_vnd),
          active: r.is_active as boolean,
          slug: r.slug as string,
          productName: r.product_name as string,
          published: r.published as boolean,
          customizable: r.is_customizable as boolean,
          available: r.available as number,
          hatWidthCm: r.hat_width_cm === null ? null : Number(r.hat_width_cm),
          hatHeightCm: r.hat_height_cm === null ? null : Number(r.hat_height_cm),
          imageKey: (r.image_key as string | null) ?? null,
          baseImage: r.image_key
            ? {
                key: r.image_key as string,
                width: r.image_width as number,
                height: r.image_height as number,
              }
            : null,
        }
      : null;
  }

  async insertDesign(
    c: Q,
    owner: DesignOwner,
    title: string,
    contactEmail: string | null,
  ): Promise<string> {
    const [userId, guest] = this.ownerParams(owner);
    const { rows } = await c.query(
      'INSERT INTO custom_designs (user_id, guest_token_hash, title, contact_email) VALUES ($1,$2,$3,$4) RETURNING id',
      [userId, guest, title, contactEmail],
    );
    return rows[0].id;
  }
  async insertVersion(
    c: Q,
    designId: string,
    versionNo: number,
    variantId: string,
  ): Promise<string> {
    // hat_color_id is a legacy NOT NULL column: the hat colour is now the variant's own picture.
    const { rows } = await c.query(
      "INSERT INTO custom_design_versions (design_id, version_no, variant_id, hat_color_id) VALUES ($1,$2,$3,'-') RETURNING id",
      [designId, versionNo, variantId],
    );
    return rows[0].id;
  }
  async replaceLayers(c: Q, versionId: string, layers: LayerInput[]) {
    await c.query('DELETE FROM design_layers WHERE version_id = $1', [versionId]);
    for (const [position, l] of layers.entries()) {
      const props =
        l.kind === 'TEXT'
          ? { text: l.text, fontId: l.fontId }
          : l.kind === 'MOTIF'
            ? { motifId: l.motifId }
            : {};
      await c.query(
        `INSERT INTO design_layers (version_id, position, kind, props, asset_id, x, y, scale, rotation) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9)`,
        [
          versionId,
          position,
          l.kind,
          JSON.stringify(props),
          l.kind === 'IMAGE' ? l.assetId : null,
          l.x,
          l.y,
          l.scale,
          l.rotation,
        ],
      );
    }
  }
  async copyLayers(c: Q, fromVersionId: string, toVersionId: string) {
    await c.query(
      `INSERT INTO design_layers (version_id, position, kind, props, asset_id, x, y, scale, rotation)
       SELECT $2, position, kind, props, asset_id, x, y, scale, rotation FROM design_layers WHERE version_id = $1`,
      [fromVersionId, toVersionId],
    );
  }

  layerInputs(rows: LayerRow[]): LayerInput[] {
    return rows.map((l) =>
      l.kind === 'TEXT'
        ? {
            kind: 'TEXT',
            text: l.props.text ?? '',
            fontId: l.props.fontId ?? 'serif',
            x: Number(l.x),
            y: Number(l.y),
            scale: Number(l.scale),
            rotation: Number(l.rotation),
          }
        : l.kind === 'MOTIF'
          ? {
              kind: 'MOTIF',
              motifId: l.props.motifId ?? '',
              x: Number(l.x),
              y: Number(l.y),
              scale: Number(l.scale),
              rotation: Number(l.rotation),
            }
          : {
              kind: 'IMAGE',
              assetId: l.asset_id!,
              x: Number(l.x),
              y: Number(l.y),
              scale: Number(l.scale),
              rotation: Number(l.rotation),
            },
    );
  }
}
