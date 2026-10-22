import { z } from 'zod';
import { PRODUCT_COLORS, PRODUCT_STYLES } from './catalog';

const slug = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang')
  .max(120);
const colorCodes = PRODUCT_COLORS.map((c) => c.code) as [string, ...string[]];
const styleCodes = PRODUCT_STYLES.map((s) => s.code) as [string, ...string[]];
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const PRODUCT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slug.optional(),
  description: optionalText(300),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
});
export const updateCategorySchema = createCategorySchema.partial();

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: slug.optional(),
  categoryId: z.string().uuid(),
  summary: optionalText(300),
  description: optionalText(5000),
  badge: optionalText(24),
  colorCode: z.enum(colorCodes).nullable().optional(),
  styleCode: z.enum(styleCodes).nullable().optional(),
  /** Approximate real width of the hat in cm; sizes charms in the designer. */
  hatWidthCm: z.number().min(5).max(100).nullable().optional(),
  hatHeightCm: z.number().min(3).max(100).nullable().optional(),
  sortWeight: z.number().int().min(0).max(100_000).default(0),
  /** Customers may design a custom version of this product's variants (NONA Custom). */
  isCustomizable: z.boolean().default(true),
  seoTitle: optionalText(160),
  seoDescription: optionalText(300),
});
export const updateProductSchema = createProductSchema
  .partial()
  .extend({ status: z.enum(PRODUCT_STATUSES).optional(), version: z.number().int().min(1) });

const money = z.number().int().min(0).max(1_000_000_000);
export const createVariantSchema = z.object({
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,63}$/, 'SKU chỉ gồm chữ in hoa, số và dấu gạch ngang'),
  name: z.string().trim().min(1).max(80),
  priceVnd: money,
  compareAtPriceVnd: money.nullable().optional(),
  isActive: z.boolean().default(true),
  weightGrams: z.number().int().min(1).max(100_000).nullable().optional(),
});
export const updateVariantSchema = createVariantSchema.partial();

export const updateImageSchema = z.object({
  alt: z.string().trim().min(1).max(200).optional(),
  position: z.number().int().min(0).max(100).optional(),
});

export const INVENTORY_REASONS = ['RECEIPT', 'ADJUSTMENT', 'RETURN'] as const;
export const inventoryAdjustmentSchema = z.object({
  variantId: z.string().uuid(),
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'delta must not be 0')
    .refine((n) => Math.abs(n) <= 100_000),
  reason: z.enum(INVENTORY_REASONS),
  note: z.string().trim().max(300).optional(),
});

export const adminProductListQuerySchema = z.object({
  q: z.string().trim().min(1).max(80).optional(),
  status: z.enum(PRODUCT_STATUSES).optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type AdminProductListQuery = z.infer<typeof adminProductListQuerySchema>;

export const adminImageSchema = z.object({
  id: z.string(),
  url: z.string(),
  alt: z.string(),
  width: z.number().int(),
  height: z.number().int(),
  position: z.number().int(),
  variantId: z.string().nullable().default(null),
});
export const adminVariantSchema = z.object({
  id: z.string(),
  sku: z.string(),
  name: z.string(),
  priceVnd: z.number().int(),
  compareAtPriceVnd: z.number().int().nullable(),
  isActive: z.boolean(),
  weightGrams: z.number().int().nullable(),
  stock: z.number().int(),
  position: z.number().int(),
});
export const adminProductListItemSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(PRODUCT_STATUSES),
  category: z.object({ id: z.string(), name: z.string() }),
  variantCount: z.number().int(),
  imageCount: z.number().int(),
  totalStock: z.number().int(),
  priceFromVnd: z.number().int().nullable(),
  updatedAt: z.string(),
  thumbnailUrl: z.string().nullable(),
});
export const adminProductDetailSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(PRODUCT_STATUSES),
  version: z.number().int(),
  category: z.object({ id: z.string(), name: z.string() }),
  summary: z.string().nullable(),
  description: z.string().nullable(),
  badge: z.string().nullable(),
  colorCode: z.string().nullable(),
  styleCode: z.string().nullable(),
  hatWidthCm: z.number().nullable().default(null),
  hatHeightCm: z.number().nullable().default(null),
  sortWeight: z.number().int(),
  isCustomizable: z.boolean().default(false),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  variants: z.array(adminVariantSchema),
  images: z.array(adminImageSchema),
  publishIssues: z.array(z.string()),
});
export type AdminProductDetail = z.infer<typeof adminProductDetailSchema>;
export type AdminProductListItem = z.infer<typeof adminProductListItemSchema>;
export const adminProductListResponseSchema = z.object({
  items: z.array(adminProductListItemSchema),
  meta: z.object({
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export const adminCategorySchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  productCount: z.number().int(),
});
export type AdminCategory = z.infer<typeof adminCategorySchema>;
export const adminCategoryListSchema = z.object({ items: z.array(adminCategorySchema) });

export const inventoryMovementSchema = z.object({
  id: z.string(),
  delta: z.number().int(),
  reason: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  createdAt: z.string(),
});
export const adminInventoryResponseSchema = z.object({
  stock: z.number().int(),
  movements: z.array(inventoryMovementSchema),
});

export const auditLogEntrySchema = z.object({
  id: z.string(),
  action: z.string(),
  actorEmail: z.string().nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  metadata: z.record(z.unknown()),
  createdAt: z.string(),
});
export const auditLogListSchema = z.object({
  items: z.array(auditLogEntrySchema),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});

export const reorderImagesSchema = z.object({
  imageIds: z.array(z.string().uuid()).min(1).max(30),
});
