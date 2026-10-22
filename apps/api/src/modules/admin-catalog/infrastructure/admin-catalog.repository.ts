import { Inject, Injectable } from '@nestjs/common';
import type {
  AdminCategory,
  AdminProductDetail,
  AdminProductListItem,
  AdminProductListQuery,
} from '@nona/contracts';
import type pg from 'pg';
import { DatabaseService } from '../../../platform/database/database.service';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Queryable = { query: (text: string, values?: any[]) => Promise<pg.QueryResult<any>> };

const esc = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export const PRODUCT_COLUMNS: Record<string, string> = {
  name: 'name',
  slug: 'slug',
  categoryId: 'category_id',
  summary: 'summary',
  description: 'description',
  badge: 'badge',
  colorCode: 'color_code',
  styleCode: 'style_code',
  hatWidthCm: 'hat_width_cm',
  hatHeightCm: 'hat_height_cm',
  sortWeight: 'sort_weight',
  isCustomizable: 'is_customizable',
  seoTitle: 'seo_title',
  seoDescription: 'seo_description',
  status: 'status',
};
export const VARIANT_COLUMNS: Record<string, string> = {
  sku: 'sku',
  name: 'name',
  priceVnd: 'price_vnd',
  compareAtPriceVnd: 'compare_at_price_vnd',
  isActive: 'is_active',
  weightGrams: 'weight_grams',
};
export const CATEGORY_COLUMNS: Record<string, string> = {
  name: 'name',
  slug: 'slug',
  description: 'description',
  sortOrder: 'sort_order',
};

/** Builds `col = $n, ...` for the provided keys only. */
export function buildSet(
  columns: Record<string, string>,
  input: Record<string, unknown>,
  startAt = 1,
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, value] of Object.entries(input)) {
    const column = columns[key];
    if (!column || value === undefined) continue;
    values.push(value);
    sets.push(`${column} = $${startAt + values.length - 1}`);
  }
  return { sets, values };
}

@Injectable()
export class AdminCatalogRepository {
  constructor(@Inject(DatabaseService) readonly db: DatabaseService) {}

  async listProducts(query: AdminProductListQuery, mediaBase: string) {
    const where: string[] = [];
    const values: unknown[] = [];
    const p = (v: unknown) => (values.push(v), `$${values.length}`);
    if (query.status) where.push(`p.status = ${p(query.status)}`);
    if (query.categoryId) where.push(`p.category_id = ${p(query.categoryId)}`);
    if (query.q) {
      const like = p(`%${esc(query.q)}%`);
      where.push(
        `(unaccent(lower(p.name)) LIKE unaccent(lower(${like})) OR p.slug LIKE lower(${like}) OR EXISTS (SELECT 1 FROM product_variants sv WHERE sv.product_id = p.id AND sv.sku ILIKE ${like}))`,
      );
    }
    const limit = p(query.pageSize);
    const offset = p((query.page - 1) * query.pageSize);
    const { rows } = await this.db.query<{
      id: string;
      slug: string;
      name: string;
      status: AdminProductListItem['status'];
      category_id: string;
      category_name: string;
      variant_count: number;
      image_count: number;
      total_stock: number;
      price_from: string | null;
      updated_at: Date;
      thumb: string | null;
      total: string;
    }>(
      `SELECT p.id, p.slug, p.name, p.status, c.id AS category_id, c.name AS category_name, p.updated_at,
              (SELECT COUNT(*)::int FROM product_variants v WHERE v.product_id = p.id) AS variant_count,
              (SELECT COUNT(*)::int FROM product_images i WHERE i.product_id = p.id) AS image_count,
              (SELECT COALESCE(SUM(m.delta), 0)::int FROM inventory_movements m JOIN product_variants v ON v.id = m.variant_id WHERE v.product_id = p.id) AS total_stock,
              (SELECT MIN(v.price_vnd) FROM product_variants v WHERE v.product_id = p.id AND v.is_active) AS price_from,
              (SELECT i.object_key FROM product_images i WHERE i.product_id = p.id ORDER BY i.position, i.created_at LIMIT 1) AS thumb,
              COUNT(*) OVER() AS total
       FROM products p JOIN categories c ON c.id = p.category_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY p.updated_at DESC, p.id LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    const total = rows[0] ? Number(rows[0].total) : 0;
    const items: AdminProductListItem[] = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      status: r.status,
      category: { id: r.category_id, name: r.category_name },
      variantCount: r.variant_count,
      imageCount: r.image_count,
      totalStock: r.total_stock,
      priceFromVnd: r.price_from === null ? null : Number(r.price_from),
      updatedAt: r.updated_at.toISOString(),
      thumbnailUrl: r.thumb ? `${mediaBase}/${r.thumb}` : null,
    }));
    return {
      items,
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.ceil(total / query.pageSize),
      },
    };
  }

  async lockProduct(q: Queryable, id: string) {
    const { rows } = await q.query(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [id]);
    return rows[0] as Record<string, unknown> | undefined;
  }

  async publishIssues(q: Queryable, productId: string): Promise<string[]> {
    const { rows } = await q.query(
      `SELECT p.name, p.slug, p.category_id,
              (SELECT COUNT(*)::int FROM product_images WHERE product_id = p.id) AS images,
              (SELECT COUNT(*)::int FROM product_variants WHERE product_id = p.id AND is_active) AS active_variants
       FROM products p WHERE p.id = $1`,
      [productId],
    );
    const r = rows[0];
    if (!r) return ['Sản phẩm không tồn tại'];
    const issues: string[] = [];
    if (!r.name.trim()) issues.push('Thiếu tên sản phẩm');
    if (!r.slug) issues.push('Thiếu slug');
    if (!r.category_id) issues.push('Chưa chọn danh mục');
    if (r.images < 1) issues.push('Cần ít nhất 1 ảnh');
    if (r.active_variants < 1) issues.push('Cần ít nhất 1 biến thể đang bán');
    return issues;
  }

  async getDetail(q: Queryable, id: string, mediaBase: string): Promise<AdminProductDetail | null> {
    const { rows } = await q.query(
      `SELECT p.*, c.name AS category_name FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = $1`,
      [id],
    );
    const p = rows[0];
    if (!p) return null;
    const [variants, images, issues] = await Promise.all([
      q.query(
        `SELECT v.*, COALESCE((SELECT SUM(delta) FROM inventory_movements m WHERE m.variant_id = v.id), 0)::int AS stock
         FROM product_variants v WHERE v.product_id = $1 ORDER BY v.position, v.created_at`,
        [id],
      ),
      q.query('SELECT * FROM product_images WHERE product_id = $1 ORDER BY position, created_at', [
        id,
      ]),
      this.publishIssues(q, id),
    ]);
    return {
      id: p.id,
      slug: p.slug,
      name: p.name,
      status: p.status,
      version: p.version,
      category: { id: p.category_id, name: p.category_name },
      summary: p.summary,
      description: p.description,
      badge: p.badge,
      colorCode: p.color_code,
      styleCode: p.style_code,
      hatWidthCm: p.hat_width_cm === null ? null : Number(p.hat_width_cm),
      hatHeightCm: p.hat_height_cm === null ? null : Number(p.hat_height_cm),
      sortWeight: p.sort_weight,
      isCustomizable: p.is_customizable,
      seoTitle: p.seo_title,
      seoDescription: p.seo_description,
      publishedAt: p.published_at ? p.published_at.toISOString() : null,
      updatedAt: p.updated_at.toISOString(),
      variants: variants.rows.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        priceVnd: Number(v.price_vnd),
        compareAtPriceVnd: v.compare_at_price_vnd === null ? null : Number(v.compare_at_price_vnd),
        isActive: v.is_active,
        weightGrams: v.weight_grams,
        stock: v.stock,
        position: v.position,
      })),
      images: images.rows.map((i) => ({
        id: i.id,
        url: `${mediaBase}/${i.object_key}`,
        alt: i.alt,
        width: i.width,
        height: i.height,
        position: i.position,
        variantId: (i.variant_id as string | null) ?? null,
      })),
      publishIssues: issues,
    };
  }

  async listCategories(): Promise<AdminCategory[]> {
    const { rows } = await this.db.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id) AS product_count
       FROM categories c ORDER BY c.sort_order, c.name`,
    );
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      sortOrder: c.sort_order,
      productCount: c.product_count,
    }));
  }
}
