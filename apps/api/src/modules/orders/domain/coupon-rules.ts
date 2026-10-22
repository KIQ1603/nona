import type { CouponIssue, CouponType } from '@nona/contracts';

export interface CouponRecord {
  id: string;
  code: string;
  description: string | null;
  type: CouponType;
  value: number;
  minOrderVnd: number;
  maxDiscountVnd: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimitTotal: number | null;
  usageLimitPerUser: number | null;
  isActive: boolean;
  version: number;
}
export interface CouponContext {
  /** Goods subtotal before any discount. Eligibility and percentages are judged on this. */
  subtotalVnd: number;
  now: Date;
  /** APPLIED usages across all customers. */
  usedTotal: number;
  /** APPLIED usages by this customer (account, or email for guests). */
  usedByCustomer: number;
}
export type CouponEvaluation =
  | { ok: true; discountVnd: number; freeShipping: boolean }
  | { ok: false; issue: CouponIssue; message: string; details: Record<string, unknown> };

const fail = (
  issue: CouponIssue,
  message: string,
  details: Record<string, unknown> = {},
): CouponEvaluation => ({ ok: false, issue, message, details });

/**
 * Deterministic coupon eligibility + amount. Pure: the same inputs always give the same answer, so the
 * quote and the order transaction (which re-runs it under a lock) can never disagree about rules.
 * Stacking is not supported: an order carries at most one coupon.
 */
export function evaluateCoupon(c: CouponRecord, ctx: CouponContext): CouponEvaluation {
  if (!c.isActive) return fail('INACTIVE', 'Mã giảm giá này hiện không còn hiệu lực.');
  if (c.startsAt && ctx.now < c.startsAt)
    return fail('NOT_STARTED', 'Mã giảm giá chưa đến thời gian áp dụng.');
  if (c.endsAt && ctx.now >= c.endsAt) return fail('EXPIRED', 'Mã giảm giá đã hết hạn.');
  if (c.usageLimitTotal !== null && ctx.usedTotal >= c.usageLimitTotal)
    return fail('EXHAUSTED', 'Mã giảm giá đã hết lượt sử dụng.');
  if (c.usageLimitPerUser !== null && ctx.usedByCustomer >= c.usageLimitPerUser)
    return fail('USER_LIMIT', 'Bạn đã dùng hết số lượt cho mã giảm giá này.');
  if (ctx.subtotalVnd < c.minOrderVnd) {
    return fail(
      'MIN_ORDER',
      `Đơn hàng cần tối thiểu ${new Intl.NumberFormat('vi-VN').format(c.minOrderVnd)}đ để dùng mã này.`,
      { minOrderVnd: c.minOrderVnd },
    );
  }
  if (c.type === 'FREE_SHIPPING') return { ok: true, discountVnd: 0, freeShipping: true };
  const raw = c.type === 'PERCENT' ? Math.floor((ctx.subtotalVnd * c.value) / 100) : c.value;
  const capped = c.maxDiscountVnd !== null ? Math.min(raw, c.maxDiscountVnd) : raw;
  return { ok: true, discountVnd: Math.min(capped, ctx.subtotalVnd), freeShipping: false };
}
