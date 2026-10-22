import { z } from 'zod';

export const PRODUCT_COLORS = [
  { code: 'natural', label: 'Tự nhiên', swatch: '#d9c59a' },
  { code: 'red', label: 'Đỏ son', swatch: '#a93d31' },
  { code: 'blue', label: 'Xanh lam', swatch: '#466579' },
  { code: 'pink', label: 'Hồng', swatch: '#dba7a2' },
  { code: 'black', label: 'Đen', swatch: '#262521' },
] as const;
export const PRODUCT_STYLES = [
  { code: 'minimal', label: 'Tối giản' },
  { code: 'floral', label: 'Hoa lá' },
  { code: 'heritage', label: 'Di sản' },
  { code: 'modern', label: 'Đương đại' },
] as const;
export const PRODUCT_SORTS = ['featured', 'price-asc', 'price-desc', 'name'] as const;

export const MAX_PAGE_SIZE = 48;
export const DEFAULT_PAGE_SIZE = 12;

const colorCodes = PRODUCT_COLORS.map((c) => c.code) as [string, ...string[]];
const styleCodes = PRODUCT_STYLES.map((s) => s.code) as [string, ...string[]];

/** Comma-separated list of known codes; unknown values are rejected, not silently dropped. */
const codeList = (codes: [string, ...string[]]) =>
  z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(codes)).max(codes.length))
    .transform((v) => [...new Set(v)]);

/** Query-string contract for GET /v1/products. Shared by API validation and the web URL parser. */
export const productListQuerySchema = z.object({
  /** Fetch specific products by slug (wishlist). Unknown slugs are simply absent from the result. */
  slugs: z
    .string()
    .transform((v) =>
      v
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(
          z
            .string()
            .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
            .max(120),
        )
        .min(1)
        .max(MAX_PAGE_SIZE),
    )
    .optional(),
  category: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80)
    .optional(),
  q: z.string().trim().min(1).max(80).optional(),
  minPriceVnd: z.coerce.number().int().min(0).max(100_000_000).optional(),
  maxPriceVnd: z.coerce.number().int().min(0).max(100_000_000).optional(),
  colors: codeList(colorCodes).optional(),
  styles: codeList(styleCodes).optional(),
  sort: z.enum(PRODUCT_SORTS).default('featured'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const availabilitySchema = z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']);
export type Availability = z.infer<typeof availabilitySchema>;
export const LOW_STOCK_THRESHOLD = 5;

export const productImageSchema = z.object({
  url: z.string(),
  alt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  /** Set when the picture belongs to one variant (e.g. the red hat's own picture). */
  variantId: z.string().nullable().default(null),
});

export const categorySchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  productCount: z.number().int(),
});
export type CategoryDto = z.infer<typeof categorySchema>;

export const productListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  summary: z.string().nullable(),
  category: z.object({ slug: z.string(), name: z.string() }),
  badge: z.string().nullable(),
  colorCode: z.string().nullable(),
  styleCode: z.string().nullable(),
  priceVnd: z.number().int().nonnegative(),
  compareAtPriceVnd: z.number().int().nonnegative().nullable(),
  hasMultiplePrices: z.boolean(),
  variantCount: z.number().int().positive(),
  /** Cheapest active variant; use it for one-click add when variantCount is 1. */
  defaultVariantId: z.string(),
  availability: availabilitySchema,
  image: productImageSchema.nullable(),
});
export type ProductListItem = z.infer<typeof productListItemSchema>;

export const productVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  priceVnd: z.number().int().nonnegative(),
  compareAtPriceVnd: z.number().int().nonnegative().nullable(),
  availability: availabilitySchema,
});

export const productDetailSchema = productListItemSchema.extend({
  description: z.string().nullable(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  images: z.array(productImageSchema),
  variants: z.array(productVariantSchema),
});
export type ProductDetail = z.infer<typeof productDetailSchema>;

export const productListResponseSchema = z.object({
  items: z.array(productListItemSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
  facets: z.object({ priceMinVnd: z.number().int(), priceMaxVnd: z.number().int() }),
});
export type ProductListResponse = z.infer<typeof productListResponseSchema>;

export const categoryListResponseSchema = z.object({ items: z.array(categorySchema) });
export type CategoryListResponse = z.infer<typeof categoryListResponseSchema>;

export function availabilityFromQuantity(quantity: number): Availability {
  if (quantity <= 0) return 'OUT_OF_STOCK';
  return quantity <= LOW_STOCK_THRESHOLD ? 'LOW_STOCK' : 'IN_STOCK';
}
