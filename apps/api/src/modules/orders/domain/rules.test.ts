import { describe, expect, it } from 'vitest';
import { evaluateCoupon, type CouponRecord } from './coupon-rules';
import { normalizeProvince, resolveShipping } from './shipping-zone';

const coupon = (o: Partial<CouponRecord> = {}): CouponRecord => ({
  id: '1',
  code: 'SALE10',
  description: null,
  type: 'PERCENT',
  value: 10,
  minOrderVnd: 0,
  maxDiscountVnd: null,
  startsAt: null,
  endsAt: null,
  usageLimitTotal: null,
  usageLimitPerUser: null,
  isActive: true,
  version: 1,
  ...o,
});
const ctx = (o: object = {}) => ({
  subtotalVnd: 500_000,
  now: new Date('2026-10-10T00:00:00Z'),
  usedTotal: 0,
  usedByCustomer: 0,
  ...o,
});

describe('evaluateCoupon', () => {
  it('computes percent, capped percent, fixed (never above the goods) and free-shipping', () => {
    expect(evaluateCoupon(coupon(), ctx())).toEqual({
      ok: true,
      discountVnd: 50_000,
      freeShipping: false,
    });
    expect(evaluateCoupon(coupon({ maxDiscountVnd: 30_000 }), ctx())).toMatchObject({
      discountVnd: 30_000,
    });
    expect(evaluateCoupon(coupon({ type: 'FIXED', value: 80_000 }), ctx())).toMatchObject({
      discountVnd: 80_000,
    });
    expect(evaluateCoupon(coupon({ type: 'FIXED', value: 900_000 }), ctx())).toMatchObject({
      discountVnd: 500_000,
    });
    expect(evaluateCoupon(coupon({ type: 'FREE_SHIPPING', value: 0 }), ctx())).toEqual({
      ok: true,
      discountVnd: 0,
      freeShipping: true,
    });
  });
  it('floors percentages so rounding never favours the shopper', () => {
    expect(evaluateCoupon(coupon({ value: 15 }), ctx({ subtotalVnd: 333_333 }))).toMatchObject({
      discountVnd: 49_999,
    });
  });
  it('enforces the activation window (start inclusive, end exclusive)', () => {
    const c = coupon({
      startsAt: new Date('2026-10-10T00:00:00Z'),
      endsAt: new Date('2026-10-11T00:00:00Z'),
    });
    expect(evaluateCoupon(c, ctx({ now: new Date('2026-10-09T23:59:59Z') }))).toMatchObject({
      ok: false,
      issue: 'NOT_STARTED',
    });
    expect(evaluateCoupon(c, ctx({ now: new Date('2026-10-10T00:00:00Z') })).ok).toBe(true);
    expect(evaluateCoupon(c, ctx({ now: new Date('2026-10-11T00:00:00Z') }))).toMatchObject({
      ok: false,
      issue: 'EXPIRED',
    });
  });
  it('enforces total and per-customer limits and the minimum order', () => {
    expect(evaluateCoupon(coupon({ usageLimitTotal: 5 }), ctx({ usedTotal: 5 }))).toMatchObject({
      ok: false,
      issue: 'EXHAUSTED',
    });
    expect(evaluateCoupon(coupon({ usageLimitTotal: 5 }), ctx({ usedTotal: 4 })).ok).toBe(true);
    expect(
      evaluateCoupon(coupon({ usageLimitPerUser: 1 }), ctx({ usedByCustomer: 1 })),
    ).toMatchObject({ ok: false, issue: 'USER_LIMIT' });
    const min = evaluateCoupon(coupon({ minOrderVnd: 600_000 }), ctx());
    expect(min).toMatchObject({ ok: false, issue: 'MIN_ORDER', details: { minOrderVnd: 600_000 } });
    expect(evaluateCoupon(coupon({ minOrderVnd: 500_000 }), ctx()).ok).toBe(true);
  });
  it('rejects inactive coupons first', () => {
    expect(evaluateCoupon(coupon({ isActive: false }), ctx())).toMatchObject({
      ok: false,
      issue: 'INACTIVE',
    });
  });
});

describe('shipping zones', () => {
  const rules = {
    freeThresholdVnd: 600_000,
    flatFeeVnd: 30_000,
    zones: [
      {
        name: 'Nội thành HCM',
        provinces: ['Hồ Chí Minh', 'Hà Nội'],
        flatFeeVnd: 20_000,
        freeShippingThresholdVnd: 300_000,
      },
      {
        name: 'Miền núi',
        provinces: ['Lai Châu'],
        flatFeeVnd: 55_000,
        freeShippingThresholdVnd: null,
      },
    ],
  };
  it('normalizes province spellings', () => {
    expect(normalizeProvince('TP. Hồ Chí Minh')).toBe('ho chi minh');
    expect(normalizeProvince('Thành phố Hồ Chí Minh')).toBe('ho chi minh');
    expect(normalizeProvince('  tỉnh Lai Châu ')).toBe('lai chau');
    expect(normalizeProvince('Đà Nẵng')).toBe('da nang');
  });
  it('uses the matching zone, else the defaults', () => {
    expect(resolveShipping(rules, 'TP. Hồ Chí Minh')).toEqual({
      freeThresholdVnd: 300_000,
      flatFeeVnd: 20_000,
      zoneName: 'Nội thành HCM',
    });
    expect(resolveShipping(rules, 'lai chau')).toMatchObject({
      flatFeeVnd: 55_000,
      freeThresholdVnd: null,
      zoneName: 'Miền núi',
    });
    expect(resolveShipping(rules, 'Cần Thơ')).toEqual({
      freeThresholdVnd: 600_000,
      flatFeeVnd: 30_000,
      zoneName: null,
    });
    expect(resolveShipping(rules, '')).toMatchObject({ zoneName: null });
    expect(resolveShipping(rules, undefined)).toMatchObject({ zoneName: null });
  });
});
