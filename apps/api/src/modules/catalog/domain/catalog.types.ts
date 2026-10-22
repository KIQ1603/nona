import type { ProductListQuery } from '@nona/contracts';

/** Persistence-agnostic records returned by the catalog repository port. */
export interface ProductListRecord {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  categorySlug: string;
  categoryName: string;
  badge: string | null;
  colorCode: string | null;
  styleCode: string | null;
  minPriceVnd: number;
  maxPriceVnd: number;
  compareAtPriceVnd: number | null;
  availableQuantity: number;
  variantCount: number;
  defaultVariantId: string;
  image: ImageRecord | null;
}

export interface ImageRecord {
  objectKey: string;
  alt: string;
  width: number;
  height: number;
  variantId?: string | null;
}

export interface VariantRecord {
  id: string;
  sku: string;
  name: string;
  priceVnd: number;
  compareAtPriceVnd: number | null;
  availableQuantity: number;
}

export interface ProductDetailRecord extends ProductListRecord {
  description: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  images: ImageRecord[];
  variants: VariantRecord[];
}

export interface CategoryRecord {
  slug: string;
  name: string;
  description: string | null;
  productCount: number;
}

export interface ProductPage {
  records: ProductListRecord[];
  total: number;
  priceMinVnd: number;
  priceMaxVnd: number;
}

/** Port implemented by the SQL repository; the application layer depends only on this. */
export interface CatalogRepository {
  listCategories(): Promise<CategoryRecord[]>;
  listProducts(query: ProductListQuery): Promise<ProductPage>;
  findProductBySlug(slug: string): Promise<ProductDetailRecord | null>;
}

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');
