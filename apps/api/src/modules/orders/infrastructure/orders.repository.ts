import { Inject, Injectable } from '@nestjs/common';
import type { OrderStatus } from '@nona/contracts';
import type pg from 'pg';
import { DatabaseService } from '../../../platform/database/database.service';
import {
  availableQtySql,
  ledgerQtySql,
  reservedQtySql,
} from '../../inventory/infrastructure/availability';

type Q = Pick<pg.PoolClient, 'query'> | Pick<pg.Pool, 'query'>;
export type Provider = 'COD' | 'VNPAY';
export type Actor = 'CUSTOMER' | 'GUEST' | 'ADMIN' | 'SYSTEM';

export interface LockedLine {
  cartItemId: string;
  quantity: number;
  variantId: string;
  sku: string;
  variantName: string;
  unitPriceVnd: number;
  active: boolean;
  published: boolean;
  available: number;
  productSlug: string;
  productName: string;
  imageKey: string | null;
  /** Set for customised lines. unitPriceVnd already includes the version's frozen price addition. */
  designVersionId: string | null;
  designStatus: string | null;
}

export interface OrderRow {
  id: string;
  public_code: string;
  user_id: string | null;
  customer_email: string | null;
  status: OrderStatus;
  payment_method: Provider;
  subtotal_vnd: string;
  discount_vnd: string;
  shipping_fee_vnd: string;
  total_vnd: string;
  shipping_address: {
    fullName: string;
    phone: string;
    line1: string;
    ward: string;
    district: string;
    province: string;
  };
  customer_note: string | null;
  version: number;
  placed_at: Date;
  payment_expires_at: Date | null;
  coupon_code: string | null;
}

export interface PaymentRow {
  id: string;
  order_id: string;
  provider: Provider;
  amount_vnd: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED' | 'REFUNDED';
  provider_ref: string | null;
  provider_transaction_no: string | null;
  refunded_vnd: string;
  paid_at: Date | null;
  created_at: Date;
}

export interface NewOrder {
  code: string;
  userId: string | null;
  email: string | null;
  status: OrderStatus;
  paymentMethod: Provider;
  subtotalVnd: number;
  discountVnd: number;
  shippingFeeVnd: number;
  totalVnd: number;
  address: Record<string, string>;
  note: string | null;
  paymentExpiresAt: Date | null;
  couponCode: string | null;
}

@Injectable()
export class OrdersRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  private get pool() {
    return this.db.pool;
  }

  /**
   * Locks the variant rows of a cart in a fixed order (so concurrent checkouts cannot deadlock), then
   * reads availability in a NEW statement. Under READ COMMITTED a statement that waited for a lock still
   * uses its old snapshot, so availability must never be computed in the locking statement itself.
   */
  async lockLines(c: pg.PoolClient, cartId: string): Promise<LockedLine[]> {
    await c.query(
      `SELECT v.id FROM cart_items ci JOIN product_variants v ON v.id = ci.variant_id
       WHERE ci.cart_id = $1 ORDER BY v.id FOR UPDATE OF v`,
      [cartId],
    );
    const { rows } = await c.query(
      `SELECT ci.id AS cart_item_id, ci.quantity, v.id AS variant_id, v.sku, v.name AS variant_name, (v.price_vnd + COALESCE(dv.price_addition_vnd, 0)) AS price_vnd, v.is_active,
              ci.design_version_id, dv.status AS design_status,
              (p.status = 'PUBLISHED') AS published, ${availableQtySql('v')} AS available,
              p.slug AS product_slug, p.name AS product_name,
              (SELECT object_key FROM product_images WHERE product_id = p.id AND (variant_id = v.id OR variant_id IS NULL) ORDER BY (variant_id IS NULL), position, created_at LIMIT 1) AS image_key
       FROM cart_items ci
       JOIN product_variants v ON v.id = ci.variant_id
       JOIN products p ON p.id = v.product_id
       LEFT JOIN custom_design_versions dv ON dv.id = ci.design_version_id
       WHERE ci.cart_id = $1
       ORDER BY v.id`,
      [cartId],
    );
    return rows.map((r) => this.toLine(r));
  }

  private toLine(r: Record<string, unknown>): LockedLine {
    return {
      cartItemId: (r.cart_item_id as string) ?? '',
      quantity: r.quantity as number,
      variantId: r.variant_id as string,
      sku: r.sku as string,
      variantName: r.variant_name as string,
      unitPriceVnd: Number(r.price_vnd),
      active: r.is_active as boolean,
      published: r.published as boolean,
      available: r.available as number,
      productSlug: r.product_slug as string,
      productName: r.product_name as string,
      imageKey: (r.image_key as string | null) ?? null,
      designVersionId: (r.design_version_id as string | null) ?? null,
      designStatus: (r.design_status as string | null) ?? null,
    };
  }

  /**
   * Lines of an existing order with the variants locked, for settling a late/online payment. `available`
   * excludes this order's own ACTIVE reservation, i.e. what remains if it were not holding anything.
   */
  async lockOrderLines(c: pg.PoolClient, orderId: string): Promise<LockedLine[]> {
    await c.query(
      `SELECT v.id FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id WHERE oi.order_id = $1 ORDER BY v.id FOR UPDATE OF v`,
      [orderId],
    );
    const { rows } = await c.query(
      `SELECT oi.id AS cart_item_id, oi.quantity, v.id AS variant_id, oi.sku, oi.variant_name, oi.unit_price_vnd AS price_vnd, v.is_active, true AS published,
              (${ledgerQtySql('v')} - (${reservedQtySql('v')}
                 - COALESCE((SELECT SUM(r.quantity) FROM inventory_reservations r WHERE r.variant_id = v.id AND r.order_id = $1 AND r.status = 'ACTIVE' AND r.expires_at > now()), 0)))::int AS available,
              oi.product_slug, oi.product_name, oi.image_key, oi.design_version_id, 'APPROVED' AS design_status
       FROM order_items oi JOIN product_variants v ON v.id = oi.variant_id
       WHERE oi.order_id = $1 ORDER BY v.id`,
      [orderId],
    );
    return rows.map((r) => this.toLine(r));
  }

  async insertOrder(c: pg.PoolClient, o: NewOrder): Promise<OrderRow> {
    const { rows } = await c.query(
      `INSERT INTO orders (public_code, user_id, customer_email, status, payment_method, subtotal_vnd, discount_vnd, shipping_fee_vnd, total_vnd,
                           shipping_address, customer_note, payment_expires_at, coupon_code)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13) RETURNING *`,
      [
        o.code,
        o.userId,
        o.email,
        o.status,
        o.paymentMethod,
        o.subtotalVnd,
        o.discountVnd,
        o.shippingFeeVnd,
        o.totalVnd,
        JSON.stringify(o.address),
        o.note,
        o.paymentExpiresAt,
        o.couponCode,
      ],
    );
    return rows[0];
  }

  async insertItem(
    c: pg.PoolClient,
    orderId: string,
    l: LockedLine,
    customization: object | null = null,
  ) {
    await c.query(
      `INSERT INTO order_items (order_id, variant_id, product_slug, product_name, variant_name, sku, unit_price_vnd, quantity, discount_vnd, line_total_vnd, image_key, design_version_id, customization)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9,$10,$11,$12::jsonb)`,
      [
        orderId,
        l.variantId,
        l.productSlug,
        l.productName,
        l.variantName,
        l.sku,
        l.unitPriceVnd,
        l.quantity,
        l.unitPriceVnd * l.quantity,
        l.imageKey,
        l.designVersionId,
        customization ? JSON.stringify(customization) : null,
      ],
    );
  }

  async insertDiscount(
    c: pg.PoolClient,
    d: {
      orderId: string;
      source: string;
      reference: string;
      label: string;
      appliesTo: 'GOODS' | 'SHIPPING';
      amountVnd: number;
      rule: object;
    },
  ) {
    await c.query(
      `INSERT INTO order_discounts (order_id, source, reference, label, applies_to, amount_vnd, rule) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [d.orderId, d.source, d.reference, d.label, d.appliesTo, d.amountVnd, JSON.stringify(d.rule)],
    );
  }

  async insertHistory(
    c: Q,
    h: {
      orderId: string;
      from: OrderStatus | null;
      to: OrderStatus;
      actorType: Actor;
      actorId?: string | null;
      reason?: string | null;
      metadata?: object;
    },
  ) {
    await c.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, actor_type, actor_id, reason, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
      [
        h.orderId,
        h.from,
        h.to,
        h.actorType,
        h.actorId ?? null,
        h.reason ?? null,
        JSON.stringify(h.metadata ?? {}),
      ],
    );
  }

  async insertPayment(
    c: pg.PoolClient,
    p: {
      orderId: string;
      provider: Provider;
      amountVnd: number;
      providerRef: string | null;
      idempotencyKey: string | null;
    },
  ): Promise<string> {
    const { rows } = await c.query(
      `INSERT INTO payments (order_id, provider, amount_vnd, status, provider_ref, idempotency_key) VALUES ($1,$2,$3,'PENDING',$4,$5) RETURNING id`,
      [p.orderId, p.provider, p.amountVnd, p.providerRef, p.idempotencyKey],
    );
    return rows[0].id;
  }

  /** COD: stock is sold immediately (consumed reservation + negative SALE movement). */
  async commitSale(c: pg.PoolClient, orderId: string, code: string, lines: LockedLine[]) {
    for (const l of lines) {
      await c.query(
        `INSERT INTO inventory_reservations (variant_id, order_id, quantity, status, expires_at, resolved_at) VALUES ($1,$2,$3,'CONSUMED', now() + interval '1 hour', now())`,
        [l.variantId, orderId, l.quantity],
      );
      await c.query(
        `INSERT INTO inventory_movements (variant_id, delta, reason, reference) VALUES ($1,$2,'SALE',$3)`,
        [l.variantId, -l.quantity, `order:${code}`],
      );
    }
  }

  /** Online payment: hold the stock until `expiresAt`; nothing is sold yet. */
  async reserve(c: pg.PoolClient, orderId: string, lines: LockedLine[], expiresAt: Date) {
    for (const l of lines) {
      await c.query(
        `INSERT INTO inventory_reservations (variant_id, order_id, quantity, status, expires_at) VALUES ($1,$2,$3,'ACTIVE',$4)`,
        [l.variantId, orderId, l.quantity, expiresAt],
      );
    }
  }

  /** Payment confirmed: turn the hold into a sale (SALE movements) and mark the reservations consumed. */
  async consumeReservation(c: pg.PoolClient, orderId: string, code: string) {
    const { rows } = await c.query(
      'SELECT variant_id, quantity FROM order_items WHERE order_id = $1 ORDER BY variant_id',
      [orderId],
    );
    for (const r of rows)
      await c.query(
        `INSERT INTO inventory_movements (variant_id, delta, reason, reference) VALUES ($1,$2,'SALE',$3)`,
        [r.variant_id, -r.quantity, `order:${code}`],
      );
    await c.query(
      `UPDATE inventory_reservations SET status = 'CONSUMED', resolved_at = now() WHERE order_id = $1 AND status IN ('ACTIVE','EXPIRED')`,
      [orderId],
    );
  }

  /** Cancelled before it was sold (unpaid online order): free the hold without touching the ledger. */
  async releaseHold(c: pg.PoolClient, orderId: string, status: 'RELEASED' | 'EXPIRED') {
    await c.query(
      `UPDATE inventory_reservations SET status = $2, resolved_at = now() WHERE order_id = $1 AND status = 'ACTIVE'`,
      [orderId, status],
    );
  }

  /** Returns sold quantities to the ledger (append-only RELEASE movements). */
  async releaseSale(c: pg.PoolClient, orderId: string, code: string) {
    const { rows } = await c.query(
      'SELECT variant_id, quantity FROM order_items WHERE order_id = $1 ORDER BY variant_id',
      [orderId],
    );
    for (const r of rows)
      await c.query(
        `INSERT INTO inventory_movements (variant_id, delta, reason, reference) VALUES ($1,$2,'RELEASE',$3)`,
        [r.variant_id, r.quantity, `order:${code}`],
      );
    await c.query(
      `UPDATE inventory_reservations SET status = 'RELEASED', resolved_at = now() WHERE order_id = $1 AND status IN ('ACTIVE','CONSUMED')`,
      [orderId],
    );
  }

  /** The order will not be fulfilled (expired/cancelled): the coupon use becomes available again. */
  async releaseCouponUsage(q: Q, orderId: string) {
    await q.query(
      `UPDATE coupon_usages SET status = 'RELEASED', released_at = now() WHERE order_id = $1 AND status = 'APPLIED'`,
      [orderId],
    );
  }

  /** Removes the purchased lines; the rest stay in the cart. The coupon is spent by this order either way. */
  async clearCart(c: pg.PoolClient, cartId: string, itemIds: string[], all: boolean) {
    if (all) await c.query('DELETE FROM cart_items WHERE cart_id = $1', [cartId]);
    else
      await c.query('DELETE FROM cart_items WHERE cart_id = $1 AND id = ANY($2::uuid[])', [
        cartId,
        itemIds,
      ]);
    await c.query('UPDATE carts SET updated_at = now(), coupon_code = NULL WHERE id = $1', [
      cartId,
    ]);
  }

  async lockById(c: pg.PoolClient, id: string): Promise<OrderRow | null> {
    return (
      ((await c.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [id]))
        .rows[0] as OrderRow) ?? null
    );
  }
  async lockByCode(c: pg.PoolClient, code: string): Promise<OrderRow | null> {
    return (
      ((await c.query('SELECT * FROM orders WHERE public_code = $1 FOR UPDATE', [code]))
        .rows[0] as OrderRow) ?? null
    );
  }
  async findByCode(q: Q, code: string): Promise<OrderRow | null> {
    return (
      ((await q.query('SELECT * FROM orders WHERE public_code = $1', [code]))
        .rows[0] as OrderRow) ?? null
    );
  }
  async findById(q: Q, id: string): Promise<OrderRow | null> {
    return (
      ((await q.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0] as OrderRow) ?? null
    );
  }

  async setStatus(c: Q, id: string, status: OrderStatus): Promise<OrderRow> {
    const { rows } = await c.query(
      `UPDATE orders SET status = $2, version = version + 1, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, status],
    );
    return rows[0];
  }

  async latestPayment(q: Q, orderId: string): Promise<PaymentRow | null> {
    return (
      ((
        await q.query(
          'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC, id LIMIT 1',
          [orderId],
        )
      ).rows[0] as PaymentRow) ?? null
    );
  }
  async paidPayment(q: Q, orderId: string): Promise<PaymentRow | null> {
    return (
      ((
        await q.query(
          `SELECT * FROM payments WHERE order_id = $1 AND status = 'PAID' ORDER BY paid_at DESC NULLS LAST LIMIT 1`,
          [orderId],
        )
      ).rows[0] as PaymentRow) ?? null
    );
  }

  async details(q: Q, orderId: string) {
    const [items, payment, shipment, history, refunds] = await Promise.all([
      q.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY created_at, id', [orderId]),
      q.query(
        "SELECT status, refunded_vnd FROM payments WHERE order_id = $1 ORDER BY (status = 'PAID') DESC, created_at DESC LIMIT 1",
        [orderId],
      ),
      q.query('SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1', [
        orderId,
      ]),
      q.query(
        `SELECT h.from_status, h.to_status, h.created_at, h.actor_type, h.reason, u.email AS actor_email
         FROM order_status_history h LEFT JOIN users u ON u.id = h.actor_id WHERE h.order_id = $1 ORDER BY h.seq`,
        [orderId],
      ),
      q.query('SELECT * FROM refunds WHERE order_id = $1 ORDER BY created_at, id', [orderId]),
    ]);
    return {
      items: items.rows,
      paymentStatus: (payment.rows[0]?.status ?? 'PENDING') as string,
      refundedVnd: Number(payment.rows[0]?.refunded_vnd ?? 0),
      shipment: shipment.rows[0] ?? null,
      history: history.rows,
      refunds: refunds.rows,
    };
  }

  async listByUser(userId: string, page: number, pageSize: number) {
    const { rows } = await this.pool.query(
      `SELECT o.public_code, o.status, o.total_vnd, o.placed_at, COALESCE((SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id), 0)::int AS item_count, COUNT(*) OVER() AS total
       FROM orders o WHERE o.user_id = $1 ORDER BY o.placed_at DESC, o.id LIMIT $2 OFFSET $3`,
      [userId, pageSize, (page - 1) * pageSize],
    );
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }

  async listAdmin(filter: { q?: string; status?: string }, page: number, pageSize: number) {
    const where: string[] = [];
    const values: unknown[] = [];
    const p = (v: unknown) => (values.push(v), `$${values.length}`);
    if (filter.status) where.push(`o.status = ${p(filter.status)}`);
    if (filter.q) {
      const like = p(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(
        `(o.public_code ILIKE ${like} OR o.customer_email ILIKE ${like} OR o.shipping_address->>'phone' LIKE ${like} OR unaccent(lower(o.shipping_address->>'fullName')) LIKE unaccent(lower(${like})))`,
      );
    }
    const limit = p(pageSize);
    const offset = p((page - 1) * pageSize);
    const { rows } = await this.pool.query(
      `SELECT o.id, o.public_code, o.status, o.version, o.customer_email, o.shipping_address->>'fullName' AS customer_name, o.total_vnd, o.payment_method, o.placed_at,
              COALESCE((SELECT SUM(quantity) FROM order_items i WHERE i.order_id = o.id), 0)::int AS item_count,
              COALESCE((SELECT status FROM payments pm WHERE pm.order_id = o.id ORDER BY (pm.status = 'PAID') DESC, pm.created_at DESC LIMIT 1), 'PENDING') AS payment_status,
              (SELECT COUNT(*) FROM order_items oi JOIN custom_design_versions dv ON dv.id = oi.design_version_id WHERE oi.order_id = o.id AND dv.status <> 'APPROVED')::int AS pending_designs,
              COUNT(*) OVER() AS total
       FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY o.placed_at DESC, o.id LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }
}
