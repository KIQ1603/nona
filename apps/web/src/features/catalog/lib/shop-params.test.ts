import { describe, expect, it } from 'vitest';
import { parseShopParams, toShopSearch } from './shop-params';

describe('parseShopParams', () => {
  it('returns defaults for an empty URL', () => {
    expect(parseShopParams({})).toEqual({
      colors: [],
      styles: [],
      sort: 'featured',
      page: 1,
      view: 'grid',
    });
  });

  it('parses valid values', () => {
    const p = parseShopParams({
      category: 'non-hoa',
      colors: 'red,blue',
      sort: 'price-asc',
      page: '2',
      maxPriceVnd: '500000',
      view: 'list',
    });
    expect(p).toMatchObject({
      category: 'non-hoa',
      colors: ['red', 'blue'],
      sort: 'price-asc',
      page: 2,
      maxPriceVnd: 500000,
      view: 'list',
    });
  });

  it('drops invalid values instead of throwing', () => {
    const p = parseShopParams({
      colors: 'green',
      sort: 'rating',
      page: '-3',
      maxPriceVnd: 'abc',
      category: 'Bad Slug!',
    });
    expect(p).toEqual({ colors: [], styles: [], sort: 'featured', page: 1, view: 'grid' });
  });

  it('uses the first value when a param is repeated', () => {
    expect(parseShopParams({ sort: ['name', 'price-asc'] }).sort).toBe('name');
  });
});

describe('toShopSearch', () => {
  it('omits defaults and sorts multi-values for a stable, shareable URL', () => {
    expect(toShopSearch({ sort: 'featured', page: 1, colors: [], view: 'grid' })).toBe('');
    expect(toShopSearch({ colors: ['red', 'blue'], category: 'non-hoa', page: 2 })).toBe(
      '?category=non-hoa&colors=blue%2Cred&page=2',
    );
  });

  it('round-trips through parseShopParams', () => {
    const original = parseShopParams({
      q: 'sen',
      styles: 'floral,modern',
      sort: 'name',
      view: 'list',
    });
    const url = new URLSearchParams(toShopSearch(original));
    const again = parseShopParams(Object.fromEntries(url));
    expect(again).toEqual(original);
  });
});
