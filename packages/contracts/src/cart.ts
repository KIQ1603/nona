import { z } from 'zod';
import { productImageSchema } from './catalog';

export const MAX_LINE_QUANTITY = 20;

export const addCartItemSchema = z.object({
  variantId: z.string().uuid(),
  /** Adds a customised hat: an APPROVED design version that belongs to the shopper and matches the variant. */
  designVersionId: z.string().uuid().optional(),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY).default(1),
});
export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

/** Why a line cannot currently be checked out. Lines stay visible with an explanation. */
export const CART_LINE_ISSUES = [
  'UNAVAILABLE',
  'OUT_OF_STOCK',
  'INSUFFICIENT_STOCK',
  'DESIGN_UNAVAILABLE',
] as const;

export const cartLineSchema = z.object({
  id: z.string(),
  variantId: z.string(),
  sku: z.string(),
  productSlug: z.string(),
  productName: z.string(),
  variantName: z.string(),
  image: productImageSchema.nullable(),
  unitPriceVnd: z.number().int().nonnegative(),
  compareAtPriceVnd: z.number().int().nonnegative().nullable(),
  design: z
    .object({
      versionId: z.string(),
      designId: z.string(),
      title: z.string(),
      versionNo: z.number().int(),
    })
    .nullable()
    .default(null),
  quantity: z.number().int().positive(),
  lineTotalVnd: z.number().int().nonnegative(),
  purchasable: z.boolean(),
  issue: z.enum(CART_LINE_ISSUES).nullable(),
  availableQuantity: z.number().int().nonnegative(),
  /** Set when the live price differs from the price the shopper last saw. */
  priceChange: z.object({ previousUnitPriceVnd: z.number().int().nonnegative() }).nullable(),
});
export type CartLine = z.infer<typeof cartLineSchema>;

export const cartNoticeSchema = z.object({
  code: z.enum(['QUANTITY_ADJUSTED', 'ITEM_UNAVAILABLE']),
  message: z.string(),
  itemId: z.string().nullable(),
});

export const cartSchema = z.object({
  lines: z.array(cartLineSchema),
  itemCount: z.number().int(),
  /** Sum of purchasable lines at live prices. Informational: checkout recalculates everything. */
  subtotalVnd: z.number().int().nonnegative(),
  hasPriceChanges: z.boolean(),
  hasUnavailable: z.boolean(),
  notices: z.array(cartNoticeSchema).default([]),
});
export type CartDto = z.infer<typeof cartSchema>;
