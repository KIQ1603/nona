import { Inject, Injectable } from '@nestjs/common';
import type { AppliedCoupon, CouponDto, CouponIssue } from '@nona/contracts';
import type pg from 'pg';
import { AppError } from '../../../common/errors/app-error';
import { mapDbError } from '../../../common/errors/db-errors';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { CartRepository, type Owner } from '../../cart/infrastructure/cart.repository';
import {
  evaluateCoupon,
  type CouponEvaluation,
  type CouponRecord,
} from '../../orders/domain/coupon-rules';

type Q = Pick<pg.PoolClient, 'query'> | Pick<pg.Pool, 'query'>;
export interface Customer {
  userId?: string | null;
  email?: string | null;
}
export type CouponOutcome =
  | {
      ok: true;
      coupon: CouponRecord;
      discountVnd: number;
      freeShipping: boolean;
      applied: AppliedCoupon;
    }
  | { ok: false; issue: CouponIssue; message: string; details: Record<string, unknown> };

const toRecord = (r: Record<string, unknown>): CouponRecord => ({
  id: r.id as string,
  code: r.code as string,
  description: (r.description as string | null) ?? null,
  type: r.type as CouponRecord['type'],
  value: Number(r.value),
  minOrderVnd: Number(r.min_order_vnd),
  maxDiscountVnd: r.max_discount_vnd === null ? null : Number(r.max_discount_vnd),
  startsAt: (r.starts_at as Date | null) ?? null,
  endsAt: (r.ends_at as Date | null) ?? null,
  usageLimitTotal: (r.usage_limit_total as number | null) ?? null,
  usageLimitPerUser: (r.usage_limit_per_user as number | null) ?? null,
  isActive: r.is_active as boolean,
  version: r.version as number,
});
const toDto = (r: Record<string, unknown>): CouponDto => {
  const c = toRecord(r);
  return {
    id: c.id,
    code: c.code,
    description: c.description,
    type: c.type,
    value: c.value,
    minOrderVnd: c.minOrderVnd,
    maxDiscountVnd: c.maxDiscountVnd,
    startsAt: c.startsAt?.toISOString() ?? null,
    endsAt: c.endsAt?.toISOString() ?? null,
    usageLimitTotal: c.usageLimitTotal,
    usageLimitPerUser: c.usageLimitPerUser,
    isActive: c.isActive,
    version: c.version,
    usedCount: Number(r.used_count ?? 0),
  };
};
const UNIQUE = { coupons_code_key: 'Mã giảm giá này đã tồn tại.' };
const COLUMNS: Record<string, string> = {
  description: 'description',
  type: 'type',
  value: 'value',
  minOrderVnd: 'min_order_vnd',
  maxDiscountVnd: 'max_discount_vnd',
  startsAt: 'starts_at',
  endsAt: 'ends_at',
  usageLimitTotal: 'usage_limit_total',
  usageLimitPerUser: 'usage_limit_per_user',
  isActive: 'is_active',
};

@Injectable()
export class CouponsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(CartRepository) private readonly carts: CartRepository,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---- evaluation (used by cart, quote and order creation) ----------------------------------------

  /**
   * Evaluates a code for a customer at a given goods subtotal. With `lock`, the coupon row is locked so
   * concurrent orders cannot both take the last allowed use (call inside the order transaction).
   */
  async evaluate(
    q: Q,
    code: string,
    customer: Customer,
    subtotalVnd: number,
    opts: { lock?: boolean; now?: Date } = {},
  ): Promise<CouponOutcome> {
    const { rows } = await q.query(
      `SELECT * FROM coupons WHERE code = $1${opts.lock ? ' FOR UPDATE' : ''}`,
      [code.trim().toUpperCase()],
    );
    if (!rows[0])
      return { ok: false, issue: 'NOT_FOUND', message: 'Mã giảm giá không tồn tại.', details: {} };
    const coupon = toRecord(rows[0]);
    const email = customer.email?.trim().toLowerCase() ?? null;
    const usage = await q.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE ($2::uuid IS NOT NULL AND user_id = $2) OR ($2::uuid IS NULL AND $3::text IS NOT NULL AND lower(email) = $3))::int AS mine
       FROM coupon_usages WHERE coupon_id = $1 AND status = 'APPLIED'`,
      [coupon.id, customer.userId ?? null, email],
    );
    const result: CouponEvaluation = evaluateCoupon(coupon, {
      subtotalVnd,
      now: opts.now ?? new Date(),
      usedTotal: usage.rows[0].total,
      usedByCustomer: usage.rows[0].mine,
    });
    if (!result.ok) return result;
    return {
      ok: true,
      coupon,
      discountVnd: result.discountVnd,
      freeShipping: result.freeShipping,
      applied: {
        code: coupon.code,
        type: coupon.type,
        description: coupon.description,
        discountVnd: result.discountVnd,
        freeShipping: result.freeShipping,
      },
    };
  }

  /** Records the use inside the order transaction. */
  async recordUsage(
    c: pg.PoolClient,
    coupon: CouponRecord,
    orderId: string,
    customer: Customer,
    amountVnd: number,
  ) {
    await c.query(
      `INSERT INTO coupon_usages (coupon_id, order_id, user_id, email, amount_vnd) VALUES ($1,$2,$3,$4,$5)`,
      [
        coupon.id,
        orderId,
        customer.userId ?? null,
        (customer.email ?? '').toLowerCase(),
        amountVnd,
      ],
    );
  }

  /** The order will never be fulfilled (expired/cancelled before shipping): the use becomes available again. */
  async releaseUsage(c: Q, orderId: string) {
    await c.query(
      `UPDATE coupon_usages SET status = 'RELEASED', released_at = now() WHERE order_id = $1 AND status = 'APPLIED'`,
      [orderId],
    );
  }

  // ---- cart ---------------------------------------------------------------------------------------

  async applyToCart(
    owner: Owner | null,
    customer: Customer,
    rawCode: string,
    subtotalVnd: number,
  ): Promise<AppliedCoupon> {
    if (!owner)
      throw new AppError('COUPON_INVALID', 409, 'Hãy thêm sản phẩm vào giỏ trước khi áp dụng mã.', {
        issue: 'MIN_ORDER',
      });
    const cart = await this.carts.find(this.db.pool, owner);
    if (!cart)
      throw new AppError('COUPON_INVALID', 409, 'Hãy thêm sản phẩm vào giỏ trước khi áp dụng mã.', {
        issue: 'MIN_ORDER',
      });
    const outcome = await this.evaluate(this.db.pool, rawCode, customer, subtotalVnd);
    if (!outcome.ok)
      throw new AppError('COUPON_INVALID', 409, outcome.message, {
        issue: outcome.issue,
        ...outcome.details,
      });
    await this.carts.setCoupon(this.db.pool, cart.id, outcome.coupon.code);
    return outcome.applied;
  }

  async removeFromCart(owner: Owner | null): Promise<void> {
    if (!owner) return;
    const cart = await this.carts.find(this.db.pool, owner);
    if (cart) await this.carts.setCoupon(this.db.pool, cart.id, null);
  }

  // ---- admin --------------------------------------------------------------------------------------

  async list(): Promise<{ items: CouponDto[] }> {
    const { rows } = await this.db.query(
      `SELECT c.*, (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = c.id AND u.status = 'APPLIED') AS used_count FROM coupons c ORDER BY c.created_at DESC, c.id`,
    );
    return { items: rows.map(toDto) };
  }

  async create(
    input: Record<string, unknown> & { code: string },
    actor: { userId: string; requestId?: string },
  ): Promise<CouponDto> {
    try {
      return await this.db.transaction(async (c) => {
        const { rows } = await c.query(
          `INSERT INTO coupons (code, description, type, value, min_order_vnd, max_discount_vnd, starts_at, ends_at, usage_limit_total, usage_limit_per_user, is_active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [
            input.code,
            input.description ?? null,
            input.type,
            input.value ?? 0,
            input.minOrderVnd ?? 0,
            input.maxDiscountVnd ?? null,
            input.startsAt ?? null,
            input.endsAt ?? null,
            input.usageLimitTotal ?? null,
            input.usageLimitPerUser ?? null,
            input.isActive ?? true,
            actor.userId,
          ],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'coupon.create',
            targetType: 'coupon',
            targetId: rows[0].id,
            metadata: { code: input.code, type: input.type, value: input.value },
            requestId: actor.requestId,
          },
          c,
        );
        return toDto(rows[0]);
      });
    } catch (e) {
      mapDbError(e, UNIQUE);
    }
  }

  async update(
    id: string,
    version: number,
    input: Record<string, unknown> & { code: string },
    actor: { userId: string; requestId?: string },
  ): Promise<CouponDto> {
    return this.db.transaction(async (c) => {
      const before = (await c.query('SELECT * FROM coupons WHERE id = $1 FOR UPDATE', [id]))
        .rows[0];
      if (!before) throw AppError.notFound('Không tìm thấy mã giảm giá.');
      if (before.version !== version)
        throw new AppError(
          'CONFLICT',
          409,
          'Mã giảm giá đã được người khác chỉnh sửa. Vui lòng tải lại.',
          { currentVersion: before.version },
        );
      if (input.code !== before.code)
        throw AppError.validation({
          issues: [{ path: 'code', message: 'Không thể đổi mã sau khi đã tạo. Hãy tạo mã mới.' }],
        });
      const sets: string[] = [];
      const values: unknown[] = [id, version];
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const [key, column] of Object.entries(COLUMNS)) {
        if (!(key in input)) continue;
        const to = input[key] ?? (key === 'value' || key === 'minOrderVnd' ? 0 : null);
        const from =
          before[column] instanceof Date
            ? (before[column] as Date).toISOString()
            : typeof before[column] === 'string' && /^\d+$/.test(before[column] as string)
              ? Number(before[column])
              : before[column];
        if (JSON.stringify(from ?? null) !== JSON.stringify(to)) changes[key] = { from, to };
        values.push(to);
        sets.push(`${column} = $${values.length}`);
      }
      try {
        const { rows } = await c.query(
          `UPDATE coupons SET ${sets.join(', ')}, version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 RETURNING *`,
          values,
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'coupon.update',
            targetType: 'coupon',
            targetId: id,
            metadata: { code: before.code, changes },
            requestId: actor.requestId,
          },
          c,
        );
        const used = await c.query(
          `SELECT COUNT(*) AS n FROM coupon_usages WHERE coupon_id = $1 AND status = 'APPLIED'`,
          [id],
        );
        return toDto({ ...rows[0], used_count: used.rows[0].n });
      } catch (e) {
        mapDbError(e, UNIQUE);
      }
    });
  }
}
