import { productListQuerySchema, type ProductListQuery } from '@nona/contracts';

/** Number of products per page on the shop; divisible by 4, 3 and 2 so every grid row is full. */
export const SHOP_PAGE_SIZE = 12;

export type RawSearchParams = Record<string, string | string[] | undefined>;
export type ShopView = 'grid' | 'list';

export interface ShopParams {
  category?: string;
  q?: string;
  maxPriceVnd?: number;
  colors: string[];
  styles: string[];
  sort: ProductListQuery['sort'];
  page: number;
  view: ShopView;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * The URL is the source of truth for shop state. Parsing is deliberately forgiving: a bad value in a
 * shared link is dropped instead of breaking the page. (The API itself stays strict.)
 */
export function parseShopParams(raw: RawSearchParams): ShopParams {
  const field = <K extends keyof ProductListQuery>(
    key: K,
    value: unknown,
  ): ProductListQuery[K] | undefined => {
    if (value === undefined || value === '') return undefined;
    const shape = productListQuerySchema.shape[key];
    const parsed = shape.safeParse(value);
    return parsed.success ? (parsed.data as ProductListQuery[K]) : undefined;
  };
  return {
    category: field('category', first(raw.category)),
    q: field('q', first(raw.q)),
    maxPriceVnd: field('maxPriceVnd', first(raw.maxPriceVnd)),
    colors: field('colors', first(raw.colors)) ?? [],
    styles: field('styles', first(raw.styles)) ?? [],
    sort: field('sort', first(raw.sort)) ?? 'featured',
    page: field('page', first(raw.page)) ?? 1,
    view: first(raw.view) === 'list' ? 'list' : 'grid',
  };
}

/** Canonical, shareable query string (defaults omitted, stable key order). */
export function toShopSearch(params: Partial<ShopParams>): string {
  const sp = new URLSearchParams();
  if (params.category) sp.set('category', params.category);
  if (params.q) sp.set('q', params.q);
  if (params.maxPriceVnd !== undefined) sp.set('maxPriceVnd', String(params.maxPriceVnd));
  if (params.colors?.length) sp.set('colors', [...params.colors].sort().join(','));
  if (params.styles?.length) sp.set('styles', [...params.styles].sort().join(','));
  if (params.sort && params.sort !== 'featured') sp.set('sort', params.sort);
  if (params.page && params.page > 1) sp.set('page', String(params.page));
  if (params.view === 'list') sp.set('view', 'list');
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const shopHref = (params: Partial<ShopParams>) => `/shop${toShopSearch(params)}`;

/** Translates UI state to the API query string. */
export function toApiSearch(query: Partial<ProductListQuery>): string {
  const sp = new URLSearchParams();
  if (query.slugs?.length) sp.set('slugs', query.slugs.join(','));
  if (query.category) sp.set('category', query.category);
  if (query.q) sp.set('q', query.q);
  if (query.minPriceVnd !== undefined) sp.set('minPriceVnd', String(query.minPriceVnd));
  if (query.maxPriceVnd !== undefined) sp.set('maxPriceVnd', String(query.maxPriceVnd));
  if (query.colors?.length) sp.set('colors', query.colors.join(','));
  if (query.styles?.length) sp.set('styles', query.styles.join(','));
  if (query.sort) sp.set('sort', query.sort);
  if (query.page) sp.set('page', String(query.page));
  if (query.pageSize) sp.set('pageSize', String(query.pageSize));
  const s = sp.toString();
  return s ? `?${s}` : '';
}
