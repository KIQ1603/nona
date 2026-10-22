import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CartLine } from '@nona/contracts';
import type pg from 'pg';
import { availableQtySql } from '../../inventory/infrastructure/availability';

export type Owner = { userId: string } | { guestToken: string };
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface CartLineRow {
  id: string;
  variantId: string;
  sku: string;
  variantName: string;
  productSlug: string;
  productName: string;
  priceVnd: number;
  compareAtPriceVnd: number | null;
  seenPriceVnd: number;
  quantity: number;
  active: boolean;
  published: boolean;
  stock: number;
  /** Set for customised lines. priceVnd already includes the design's frozen price addition. */
  design: {
    versionId: string;
    designId: string;
    title: string;
    versionNo: number;
    status: string;
  } | null;
  image: { objectKey: string; alt: string; width: number; height: number } | null;
}

/** Live availability = ledger sum (Phase 4 subtracts unexpired reservations in the same place). */
export const STOCK_SQL = availableQtySql('v');

@Injectable()
export class CartRepository {
  /** Finds the owner's active cart, optionally locking the row so concurrent writes serialize. */
  async find(
    c: pg.PoolClient | pg.Pool,
    owner: Owner,
    lock = false,
  ): Promise<{ id: string; coupon_code: string | null } | null> {
    const suffix = lock ? ' FOR UPDATE' : '';
    const { rows } =
      'userId' in owner
        ? await c.query(
            `SELECT id, coupon_code FROM carts WHERE user_id = $1 AND status = 'ACTIVE'${suffix}`,
            [owner.userId],
          )
        : await c.query(
            `SELECT id, coupon_code FROM carts WHERE guest_token_hash = $1 AND status = 'ACTIVE'${suffix}`,
            [hashToken(owner.guestToken)],
          );
    return (rows[0] as { id: string; coupon_code: string | null } | undefined) ?? null;
  }

  async create(c: pg.PoolClient, owner: Owner): Promise<{ id: string }> {
    const { rows } =
      'userId' in owner
        ? await c.query(
            `INSERT INTO carts (user_id) VALUES ($1) ON CONFLICT (user_id) WHERE status = 'ACTIVE' AND user_id IS NOT NULL DO UPDATE SET updated_at = now() RETURNING id`,
            [owner.userId],
          )
        : await c.query('INSERT INTO carts (guest_token_hash) VALUES ($1) RETURNING id', [
            hashToken(owner.guestToken),
          ]);
    return rows[0] as { id: string };
  }

  async setCoupon(c: pg.PoolClient | pg.Pool, cartId: string, code: string | null) {
    await c.query('UPDATE carts SET coupon_code = $2, updated_at = now() WHERE id = $1', [
      cartId,
      code,
    ]);
  }

  async touch(c: pg.PoolClient, cartId: string) {
    await c.query('UPDATE carts SET updated_at = now() WHERE id = $1', [cartId]);
  }

  async lines(c: pg.PoolClient | pg.Pool, cartId: string): Promise<CartLineRow[]> {
    const { rows } = await c.query(
      `SELECT ci.id, ci.variant_id, ci.quantity, ci.seen_price_vnd,
              v.sku, v.name AS variant_name, (v.price_vnd + COALESCE(dv.price_addition_vnd, 0)) AS price_vnd, v.compare_at_price_vnd, v.is_active,
              dv.id AS design_version_id, dv.design_id, dv.version_no, dv.status AS design_status, dg.title AS design_title,
              p.slug, p.name AS product_name, (p.status = 'PUBLISHED') AS published,
              ${STOCK_SQL} AS stock,
              img.object_key, img.alt, img.width, img.height
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN custom_design_versions dv ON dv.id = ci.design_version_id
       LEFT JOIN custom_designs dg ON dg.id = dv.design_id
       LEFT JOIN LATERAL (SELECT object_key, alt, width, height FROM product_images WHERE product_id = p.id AND (variant_id = v.id OR variant_id IS NULL) ORDER BY (variant_id IS NULL), position, created_at LIMIT 1) img ON true
       WHERE ci.cart_id = $1 ORDER BY ci.created_at, ci.id`,
      [cartId],
    );
    return rows.map((r) => ({
      id: r.id,
      variantId: r.variant_id,
      sku: r.sku,
      variantName: r.variant_name,
      productSlug: r.slug,
      productName: r.product_name,
      priceVnd: Number(r.price_vnd),
      compareAtPriceVnd: r.compare_at_price_vnd === null ? null : Number(r.compare_at_price_vnd),
      seenPriceVnd: Number(r.seen_price_vnd),
      quantity: r.quantity,
      active: r.is_active,
      published: r.published,
      stock: r.stock,
      design: r.design_version_id
        ? {
            versionId: r.design_version_id,
            designId: r.design_id,
            title: r.design_title,
            versionNo: r.version_no,
            status: r.design_status,
          }
        : null,
      image: r.object_key
        ? { objectKey: r.object_key, alt: r.alt, width: r.width, height: r.height }
        : null,
    }));
  }

  /** Variant facts needed to validate an add/update, with the row locked against concurrent stock edits. */
  async variantForSale(c: pg.PoolClient, variantId: string) {
    const { rows } = await c.query(
      `SELECT v.id, v.price_vnd, v.is_active, (p.status = 'PUBLISHED') AS published, ${STOCK_SQL} AS stock
       FROM product_variants v JOIN products p ON p.id = v.product_id WHERE v.id = $1`,
      [variantId],
    );
    const r = rows[0];
    return r
      ? {
          id: r.id as string,
          priceVnd: Number(r.price_vnd),
          sellable: r.is_active && r.published,
          stock: r.stock as number,
        }
      : null;
  }

  async itemQuantity(
    c: pg.PoolClient,
    cartId: string,
    variantId: string,
    designVersionId: string | null = null,
  ): Promise<number> {
    const { rows } = await c.query(
      'SELECT quantity FROM cart_items WHERE cart_id = $1 AND variant_id = $2 AND design_version_id IS NOT DISTINCT FROM $3',
      [cartId, variantId, designVersionId],
    );
    return rows[0]?.quantity ?? 0;
  }

  async upsertItem(
    c: pg.PoolClient,
    cartId: string,
    variantId: string,
    quantity: number,
    priceVnd: number,
    designVersionId: string | null = null,
  ) {
    const { rows } = await c.query(
      `INSERT INTO cart_items (cart_id, variant_id, quantity, seen_price_vnd, design_version_id) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (cart_id, variant_id, (COALESCE(design_version_id, '00000000-0000-0000-0000-000000000000'::uuid)))
       DO UPDATE SET quantity = EXCLUDED.quantity, seen_price_vnd = EXCLUDED.seen_price_vnd, updated_at = now()
       RETURNING id`,
      [cartId, variantId, quantity, priceVnd, designVersionId],
    );
    return rows[0].id as string;
  }

  async findItem(c: pg.PoolClient, cartId: string, itemId: string) {
    const { rows } = await c.query(
      `SELECT ci.id, ci.variant_id, ci.quantity, ci.design_version_id,
              COALESCE((SELECT price_addition_vnd FROM custom_design_versions WHERE id = ci.design_version_id), 0) AS addition
       FROM cart_items ci WHERE ci.id = $1 AND ci.cart_id = $2 FOR UPDATE OF ci`,
      [itemId, cartId],
    );
    return (
      (rows[0] as
        | {
            id: string;
            variant_id: string;
            quantity: number;
            design_version_id: string | null;
            addition: string;
          }
        | undefined) ?? null
    );
  }

  async deleteItem(c: pg.PoolClient, cartId: string, itemId: string) {
    const res = await c.query('DELETE FROM cart_items WHERE id = $1 AND cart_id = $2', [
      itemId,
      cartId,
    ]);
    return res.rowCount === 1;
  }

  async acknowledgePrices(c: pg.PoolClient, cartId: string) {
    await c.query(
      `UPDATE cart_items ci SET seen_price_vnd = x.price, updated_at = now()
       FROM (SELECT i.id, v.price_vnd + COALESCE(dv.price_addition_vnd, 0) AS price
             FROM cart_items i JOIN product_variants v ON v.id = i.variant_id
             LEFT JOIN custom_design_versions dv ON dv.id = i.design_version_id WHERE i.cart_id = $1) x
       WHERE ci.id = x.id AND ci.seen_price_vnd <> x.price`,
      [cartId],
    );
  }

  async guestItems(c: pg.PoolClient, token: string) {
    const guest = await this.find(c, { guestToken: token }, true);
    if (!guest) return null;
    const { rows } = await c.query(
      'SELECT variant_id, quantity, design_version_id FROM cart_items WHERE cart_id = $1',
      [guest.id],
    );
    return {
      cartId: guest.id,
      items: rows as { variant_id: string; quantity: number; design_version_id: string | null }[],
    };
  }

  async deleteCart(c: pg.PoolClient, cartId: string) {
    await c.query('DELETE FROM carts WHERE id = $1', [cartId]);
  }
}

export type { CartLine };
