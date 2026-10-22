import { describe, expect, it } from 'vitest';
import { availabilityFromQuantity, productListQuerySchema } from './catalog';
import { formatVnd } from './money';

describe('productListQuerySchema', () => {
  it('applies defaults', () => {
    const q = productListQuerySchema.parse({});
    expect(q).toMatchObject({ sort: 'featured', page: 1, pageSize: 12 });
  });
  it('parses csv filters and dedupes', () => {
    const q = productListQuerySchema.parse({ colors: 'red,blue,red', styles: 'floral' });
    expect(q.colors).toEqual(['red', 'blue']);
    expect(q.styles).toEqual(['floral']);
  });
  it('rejects unknown filter codes, sorts and oversize pages', () => {
    expect(productListQuerySchema.safeParse({ colors: 'green' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ sort: 'rating' }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ pageSize: 500 }).success).toBe(false);
    expect(productListQuerySchema.safeParse({ minPriceVnd: 1.5 }).success).toBe(false);
  });
});

describe('availabilityFromQuantity', () => {
  it('maps quantities', () => {
    expect(availabilityFromQuantity(0)).toBe('OUT_OF_STOCK');
    expect(availabilityFromQuantity(-2)).toBe('OUT_OF_STOCK');
    expect(availabilityFromQuantity(5)).toBe('LOW_STOCK');
    expect(availabilityFromQuantity(6)).toBe('IN_STOCK');
  });
});

describe('formatVnd', () => {
  it('formats integers with vi-VN grouping', () => {
    expect(formatVnd(590000)).toBe('590.000đ');
  });
});
