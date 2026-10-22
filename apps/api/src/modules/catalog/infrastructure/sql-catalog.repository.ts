import { Inject, Injectable } from '@nestjs/common';
import type { ProductListQuery } from '@nona/contracts';
import { reservedQtySql } from '../../inventory/infrastructure/availability';
import { DatabaseService } from '../../../platform/database/database.service';
import type {
  CatalogRepository,
  CategoryRecord,
  ImageRecord,
  ProductDetailRecord,
  ProductListRecord,
  ProductPage,
  VariantRecord,
} from '../domain/catalog.types';

/**
 * Stock per variant is always derived from the append-only inventory ledger, never a cached counter.
 * (Phase 4 subtracts unexpired reservations here.)
 */
const VARIANT_STOCK_CTE = `
  variant_stock AS (
    SELECT v.id, v.product_id, v.price_vnd, v.compare_at_price_vnd, v.position,
           (COALESCE(SUM(m.delta), 0) - ${reservedQtySql('v')})::int AS qty
    FROM product_variants v
    LEFT JOIN inventory_movements m ON m.variant_id = v.id
    WHERE v.is_active
    GROUP BY v.id
  ),
  product_agg AS (
    SELECT product_id,
           MIN(price_vnd)::bigint AS min_price,
           MAX(price_vnd)::bigint AS max_price,
           SUM(GREATEST(qty, 0))::int AS total_qty,
           COUNT(*)::int AS variant_count,
           (array_agg(id ORDER BY price_vnd, position))[1] AS default_variant_id,
           (array_agg(compare_at_price_vnd ORDER BY price_vnd, position))[1] AS compare_at
    FROM variant_stock
    GROUP BY product_id
  )`;

const SORTS: Record<ProductListQuery['sort'], string> = {
  featured: 'p.sort_weight DESC, p.id',
  'price-asc': 'a.min_price ASC, p.id',
  'price-desc': 'a.min_price DESC, p.id',
  name: 'p.name COLLATE "vi-VN-x-icu" ASC, p.id',
};

interface ListRow {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  category_slug: string;
  category_name: string;
  badge: string | null;
  color_code: string | null;
  style_code: string | null;
  min_price: string;
  max_price: string;
  compare_at: string | null;
  total_qty: number;
  variant_count: number;
  default_variant_id: string;
  image_key: string | null;
  image_alt: string | null;
  image_width: number | null;
  image_height: number | null;
  total_count?: string;
}

const toRecord = (r: ListRow): ProductListRecord => ({
  id: r.id,
  slug: r.slug,
  name: r.name,
  summary: r.summary,
  categorySlug: r.category_slug,
  categoryName: r.category_name,
  badge: r.badge,
  colorCode: r.color_code,
  styleCode: r.style_code,
  minPriceVnd: Number(r.min_price),
  maxPriceVnd: Number(r.max_price),
  compareAtPriceVnd: r.compare_at === null ? null : Number(r.compare_at),
  availableQuantity: r.total_qty,
  variantCount: r.variant_count,
  defaultVariantId: r.default_variant_id,
  image: r.image_key
    ? {
        objectKey: r.image_key,
        alt: r.image_alt ?? '',
        width: r.image_width ?? 0,
        height: r.image_height ?? 0,
      }
    : null,
});

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

@Injectable()
export class SqlCatalogRepository implements CatalogRepository {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async listCategories(): Promise<CategoryRecord[]> {
    const { rows } = await this.db.query<{
      slug: string;
      name: string;
      description: string | null;
      product_count: number;
    }>(`
      SELECT c.slug, c.name, c.description,
             COUNT(DISTINCT p.id) FILTER (WHERE EXISTS (
               SELECT 1 FROM product_variants v WHERE v.product_id = p.id AND v.is_active))::int AS product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id AND p.status = 'PUBLISHED'
      GROUP BY c.id
      ORDER BY c.sort_order, c.name`);
    return rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      productCount: r.product_count,
    }));
  }

  async listProducts(query: ProductListQuery): Promise<ProductPage> {
    const where: string[] = [`p.status = 'PUBLISHED'`];
    const values: unknown[] = [];
    const param = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (query.slugs?.length) where.push(`p.slug = ANY(${param(query.slugs)}::text[])`);
    if (query.category) where.push(`c.slug = ${param(query.category)}`);
    if (query.colors?.length) where.push(`p.color_code = ANY(${param(query.colors)}::text[])`);
    if (query.styles?.length) where.push(`p.style_code = ANY(${param(query.styles)}::text[])`);
    if (query.minPriceVnd !== undefined) where.push(`a.max_price >= ${param(query.minPriceVnd)}`);
    if (query.maxPriceVnd !== undefined) where.push(`a.min_price <= ${param(query.maxPriceVnd)}`);
    if (query.q) {
      const like = param(`%${escapeLike(query.q)}%`);
      where.push(
        `(unaccent(lower(p.name)) LIKE unaccent(lower(${like})) OR unaccent(lower(COALESCE(p.summary, ''))) LIKE unaccent(lower(${like})))`,
      );
    }

    const limit = param(query.pageSize);
    const offset = param((query.page - 1) * query.pageSize);

    const { rows } = await this.db.query<ListRow>(
      `WITH ${VARIANT_STOCK_CTE}
       SELECT p.id, p.slug, p.name, p.summary, c.slug AS category_slug, c.name AS category_name,
              p.badge, p.color_code, p.style_code, a.min_price, a.max_price, a.compare_at, a.total_qty, a.variant_count, a.default_variant_id,
              img.object_key AS image_key, img.alt AS image_alt, img.width AS image_width, img.height AS image_height,
              COUNT(*) OVER() AS total_count
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN product_agg a ON a.product_id = p.id
       LEFT JOIN LATERAL (
         SELECT object_key, alt, width, height FROM product_images
         WHERE product_id = p.id ORDER BY (variant_id IS NOT NULL), position, created_at LIMIT 1) img ON true
       WHERE ${where.join(' AND ')}
       ORDER BY ${SORTS[query.sort]}
       LIMIT ${limit} OFFSET ${offset}`,
      values,
    );

    let total = rows[0] ? Number(rows[0].total_count) : 0;
    if (!rows.length && query.page > 1)
      total = await this.countProducts(where, values.slice(0, -2));

    const facets = await this.db.query<{ lo: string | null; hi: string | null }>(
      `WITH ${VARIANT_STOCK_CTE}
       SELECT MIN(a.min_price) AS lo, MAX(a.max_price) AS hi
       FROM products p JOIN product_agg a ON a.product_id = p.id WHERE p.status = 'PUBLISHED'`,
    );

    return {
      records: rows.map(toRecord),
      total,
      priceMinVnd: Number(facets.rows[0]?.lo ?? 0),
      priceMaxVnd: Number(facets.rows[0]?.hi ?? 0),
    };
  }

  private async countProducts(where: string[], values: unknown[]): Promise<number> {
    const { rows } = await this.db.query<{ n: string }>(
      `WITH ${VARIANT_STOCK_CTE}
       SELECT COUNT(*) AS n FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN product_agg a ON a.product_id = p.id
       WHERE ${where.join(' AND ')}`,
      values,
    );
    return Number(rows[0]?.n ?? 0);
  }

  async findProductBySlug(slug: string): Promise<ProductDetailRecord | null> {
    const { rows } = await this.db.query<
      ListRow & {
        description: string | null;
        seo_title: string | null;
        seo_description: string | null;
      }
    >(
      `WITH ${VARIANT_STOCK_CTE}
       SELECT p.id, p.slug, p.name, p.summary, p.description, p.seo_title, p.seo_description,
              c.slug AS category_slug, c.name AS category_name, p.badge, p.color_code, p.style_code,
              a.min_price, a.max_price, a.compare_at, a.total_qty, a.variant_count, a.default_variant_id,
              NULL::text AS image_key, NULL::text AS image_alt, NULL::int AS image_width, NULL::int AS image_height
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN product_agg a ON a.product_id = p.id
       WHERE p.slug = $1 AND p.status = 'PUBLISHED'`,
      [slug],
    );
    const row = rows[0];
    if (!row) return null;

    const [images, variants] = await Promise.all([
      this.db.query<{
        object_key: string;
        alt: string;
        width: number;
        height: number;
        variant_id: string | null;
      }>(
        `SELECT object_key, alt, width, height, variant_id FROM product_images
         WHERE product_id = $1 ORDER BY (variant_id IS NOT NULL), position, created_at`,
        [row.id],
      ),
      this.db.query<{
        id: string;
        sku: string;
        name: string;
        price_vnd: string;
        compare_at_price_vnd: string | null;
        qty: number;
      }>(
        `SELECT v.id, v.sku, v.name, v.price_vnd, v.compare_at_price_vnd,
                (COALESCE(SUM(m.delta), 0) - ${reservedQtySql('v')})::int AS qty
         FROM product_variants v
         LEFT JOIN inventory_movements m ON m.variant_id = v.id
         WHERE v.product_id = $1 AND v.is_active
         GROUP BY v.id ORDER BY v.position, v.created_at`,
        [row.id],
      ),
    ]);

    const imageRecords: ImageRecord[] = images.rows.map((i) => ({
      objectKey: i.object_key,
      alt: i.alt,
      width: i.width,
      height: i.height,
      variantId: i.variant_id,
    }));
    const variantRecords: VariantRecord[] = variants.rows.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      priceVnd: Number(v.price_vnd),
      compareAtPriceVnd: v.compare_at_price_vnd === null ? null : Number(v.compare_at_price_vnd),
      availableQuantity: Math.max(v.qty, 0),
    }));

    return {
      ...toRecord(row),
      image: imageRecords[0] ?? null,
      description: row.description,
      seoTitle: row.seo_title,
      seoDescription: row.seo_description,
      images: imageRecords,
      variants: variantRecords,
    };
  }
}
