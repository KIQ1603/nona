import { describe, expect, it } from 'vitest';
import { AppError } from '../../../common/errors/app-error';
import { assertTransition, customerCanCancel } from './order-state';
import {
  formatOrderCode,
  generateOrderCode,
  normalizeOrderCode,
  ORDER_CODE_PATTERN,
} from './order-code';
import { priceOrder } from './pricing';

const ship = { freeThresholdVnd: 600_000, flatFeeVnd: 30_000 };

describe('priceOrder', () => {
  it('sums integer VND and charges the configured flat fee below the threshold', () => {
    const p = priceOrder({ lines: [{ unitPriceVnd: 190_000, quantity: 2 }], shipping: ship });
    expect(p).toMatchObject({
      subtotalVnd: 380_000,
      discountVnd: 0,
      shippingFeeVnd: 30_000,
      totalVnd: 410_000,
    });
    expect(p.freeShipping).toEqual({
      thresholdVnd: 600_000,
      remainingVnd: 220_000,
      applied: false,
    });
  });

  it('makes shipping free exactly at the threshold, not just below it', () => {
    expect(
      priceOrder({ lines: [{ unitPriceVnd: 300_000, quantity: 2 }], shipping: ship })
        .shippingFeeVnd,
    ).toBe(0);
    expect(
      priceOrder({ lines: [{ unitPriceVnd: 299_999, quantity: 2 }], shipping: ship })
        .shippingFeeVnd,
    ).toBe(30_000);
  });

  it('applies the free-shipping threshold to the discounted amount', () => {
    const p = priceOrder({
      lines: [{ unitPriceVnd: 650_000, quantity: 1 }],
      discounts: [{ source: 'T', label: 'T', amountVnd: 100_000 }],
      shipping: ship,
    });
    expect(p).toMatchObject({ discountVnd: 100_000, shippingFeeVnd: 30_000, totalVnd: 580_000 });
  });

  it('caps discounts so goods never go negative and records each applied discount', () => {
    const p = priceOrder({
      lines: [{ unitPriceVnd: 100_000, quantity: 1 }],
      discounts: [
        { source: 'A', label: 'A', amountVnd: 70_000 },
        { source: 'B', label: 'B', amountVnd: 70_000 },
        { source: 'C', label: 'C', amountVnd: 5 },
      ],
      shipping: { freeThresholdVnd: null, flatFeeVnd: 25_000 },
    });
    expect(p.discounts.map((d) => d.amountVnd)).toEqual([70_000, 30_000]);
    expect(p).toMatchObject({
      subtotalVnd: 100_000,
      discountVnd: 100_000,
      shippingFeeVnd: 25_000,
      totalVnd: 25_000,
    });
  });

  it('supports "no free shipping offer" and "always free"', () => {
    expect(
      priceOrder({
        lines: [{ unitPriceVnd: 5_000_000, quantity: 1 }],
        shipping: { freeThresholdVnd: null, flatFeeVnd: 30_000 },
      }).shippingFeeVnd,
    ).toBe(30_000);
    const free = priceOrder({
      lines: [{ unitPriceVnd: 1_000, quantity: 1 }],
      shipping: { freeThresholdVnd: null, flatFeeVnd: 0 },
    });
    expect(free.shippingFeeVnd).toBe(0);
    expect(free.freeShipping.applied).toBe(true);
  });

  it('rejects non-integer prices and invalid quantities', () => {
    expect(() =>
      priceOrder({ lines: [{ unitPriceVnd: 1000.5, quantity: 1 }], shipping: ship }),
    ).toThrow(RangeError);
    expect(() =>
      priceOrder({ lines: [{ unitPriceVnd: 1000, quantity: 0 }], shipping: ship }),
    ).toThrow(RangeError);
    expect(() =>
      priceOrder({ lines: [{ unitPriceVnd: -1, quantity: 1 }], shipping: ship }),
    ).toThrow(RangeError);
  });

  it('never charges shipping for an empty order', () => {
    expect(priceOrder({ lines: [], shipping: ship }).totalVnd).toBe(0);
  });
});

describe('order state machine', () => {
  it('allows the COD fulfilment path and nothing else', () => {
    for (const [from, to] of [
      ['CONFIRMED', 'PROCESSING'],
      ['PROCESSING', 'READY_TO_SHIP'],
      ['READY_TO_SHIP', 'SHIPPING'],
      ['SHIPPING', 'COMPLETED'],
      ['CONFIRMED', 'CANCELLED'],
      ['READY_TO_SHIP', 'CANCELLED'],
    ] as const) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });
  it('refuses skips, reversals and moves out of terminal states', () => {
    for (const [from, to] of [
      ['CONFIRMED', 'SHIPPING'],
      ['CONFIRMED', 'COMPLETED'],
      ['PROCESSING', 'CONFIRMED'],
      ['SHIPPING', 'CANCELLED'],
      ['COMPLETED', 'CANCELLED'],
      ['CANCELLED', 'CONFIRMED'],
      ['COMPLETED', 'PROCESSING'],
    ] as const) {
      expect(() => assertTransition(from, to), `${from}->${to}`).toThrow(AppError);
    }
  });
  it('lets customers cancel only before preparation starts', () => {
    expect(customerCanCancel('CONFIRMED')).toBe(true);
    for (const s of ['PROCESSING', 'READY_TO_SHIP', 'SHIPPING', 'COMPLETED', 'CANCELLED'] as const)
      expect(customerCanCancel(s)).toBe(false);
  });
});

describe('order codes', () => {
  it('are 12 unambiguous characters and not repeated', () => {
    const codes = new Set(Array.from({ length: 2000 }, generateOrderCode));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(ORDER_CODE_PATTERN);
  });
  it('are normalized from human input', () => {
    expect(normalizeOrderCode('ab12-cd34-ef56')).toBe('AB12CD34EF56');
    expect(normalizeOrderCode('oi0l-aaaa-bbbb')).toBe('0101AAAABBBB');
    expect(normalizeOrderCode('short')).toBeNull();
    expect(normalizeOrderCode("'; DROP TABLE orders;--")).toBeNull();
    expect(formatOrderCode('AB12CD34EF56')).toBe('AB12-CD34-EF56');
  });
});

describe('priceOrder: free-shipping coupon', () => {
  it('waives the fee that would otherwise apply and reports it', () => {
    const p = priceOrder({
      lines: [{ unitPriceVnd: 100_000, quantity: 1 }],
      waiveShipping: true,
      shipping: { freeThresholdVnd: 600_000, flatFeeVnd: 30_000, zones: [] } as never,
    });
    expect(p).toMatchObject({ shippingFeeVnd: 0, shippingWaivedVnd: 30_000, totalVnd: 100_000 });
    expect(p.freeShipping.applied).toBe(true);
    const already = priceOrder({
      lines: [{ unitPriceVnd: 700_000, quantity: 1 }],
      waiveShipping: true,
      shipping: { freeThresholdVnd: 600_000, flatFeeVnd: 30_000 },
    });
    expect(already).toMatchObject({ shippingFeeVnd: 0, shippingWaivedVnd: 0 });
  });
});
