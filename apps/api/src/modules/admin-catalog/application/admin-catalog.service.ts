import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { AdminProductListQuery } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { mapDbError } from '../../../common/errors/db-errors';
import { slugify } from '../../../common/slug';
import { ENV, type Env } from '../../../config/env';
import { AuditService } from '../../audit/application/audit.service';
import { ImageProcessor } from '../../media/application/image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from '../../media/domain';
import {
  AdminCatalogRepository,
  buildSet,
  CATEGORY_COLUMNS,
  PRODUCT_COLUMNS,
  VARIANT_COLUMNS,
  type Queryable,
} from '../infrastructure/admin-catalog.repository';

const UNIQUE_MESSAGES = {
  products_slug_key: 'Slug này đã được dùng cho sản phẩm khác.',
  product_variants_sku_key: 'SKU này đã tồn tại.',
  categories_slug_key: 'Slug danh mục đã tồn tại.',
};

export interface Actor {
  userId: string;
  requestId?: string;
}

const camel: Record<string, string> = {
  category_id: 'categoryId',
  color_code: 'colorCode',
  style_code: 'styleCode',
  hat_width_cm: 'hatWidthCm',
  hat_height_cm: 'hatHeightCm',
  sort_weight: 'sortWeight',
  is_customizable: 'isCustomizable',
  seo_title: 'seoTitle',
  seo_description: 'seoDescription',
};
/** pg returns BIGINT as string; compare/audit money as numbers. */
const norm = (v: unknown) =>
  typeof v === 'bigint'
    ? Number(v)
    : typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v) && v.length < 16
      ? Number(v)
      : v;

/** Diff of only the keys the caller sent, for audit metadata. */
function diff(
  before: Record<string, unknown>,
  input: Record<string, unknown>,
  columns: Record<string, string>,
) {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [key, to] of Object.entries(input)) {
    const column = columns[key];
    if (!column || to === undefined) continue;
    const from = norm(before[column]);
    if (from !== norm(to)) changes[key] = { from, to };
  }
  return changes;
}
void camel;

@Injectable()
export class AdminCatalogService {
  private readonly mediaBase: string;

  constructor(
    @Inject(AdminCatalogRepository) private readonly repo: AdminCatalogRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  listProducts(query: AdminProductListQuery) {
    return this.repo.listProducts(query, this.mediaBase);
  }

  async getProduct(id: string) {
    const detail = await this.repo.getDetail(this.repo.db, id, this.mediaBase);
    if (!detail) throw AppError.notFound('Không tìm thấy sản phẩm.');
    return detail;
  }

  // ---- categories -------------------------------------------------------------------------------

  listCategories() {
    return this.repo.listCategories().then((items) => ({ items }));
  }

  async createCategory(
    input: { name: string; slug?: string; description?: string | null; sortOrder: number },
    actor: Actor,
  ) {
    const slug = input.slug ?? slugify(input.name);
    if (!slug)
      throw AppError.validation({
        issues: [{ path: 'name', message: 'Không tạo được slug từ tên này' }],
      });
    try {
      return await this.repo.db.transaction(async (c) => {
        const { rows } = await c.query(
          'INSERT INTO categories (slug, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
          [slug, input.name, input.description ?? null, input.sortOrder],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'category.create',
            targetType: 'category',
            targetId: rows[0].id,
            metadata: { slug, name: input.name },
            requestId: actor.requestId,
          },
          c,
        );
        return { id: rows[0].id as string };
      });
    } catch (e) {
      mapDbError(e, UNIQUE_MESSAGES);
    }
  }

  async updateCategory(id: string, input: Record<string, unknown>, actor: Actor) {
    try {
      await this.repo.db.transaction(async (c) => {
        const before = (await c.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [id]))
          .rows[0];
        if (!before) throw AppError.notFound('Không tìm thấy danh mục.');
        const { sets, values } = buildSet(CATEGORY_COLUMNS, input, 2);
        if (!sets.length) return;
        await c.query(
          `UPDATE categories SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
          [id, ...values],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'category.update',
            targetType: 'category',
            targetId: id,
            metadata: diff(before, input, CATEGORY_COLUMNS),
            requestId: actor.requestId,
          },
          c,
        );
      });
    } catch (e) {
      mapDbError(e, UNIQUE_MESSAGES);
    }
  }

  async deleteCategory(id: string, actor: Actor) {
    try {
      await this.repo.db.transaction(async (c) => {
        const res = await c.query('DELETE FROM categories WHERE id = $1 RETURNING slug', [id]);
        if (res.rowCount !== 1) throw AppError.notFound('Không tìm thấy danh mục.');
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'category.delete',
            targetType: 'category',
            targetId: id,
            metadata: { slug: res.rows[0].slug },
            requestId: actor.requestId,
          },
          c,
        );
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23503')
        throw new AppError('CONFLICT', 409, 'Không thể xóa danh mục đang có sản phẩm.');
      throw e;
    }
  }

  // ---- products ---------------------------------------------------------------------------------

  async createProduct(
    input: Record<string, unknown> & { name: string; categoryId: string; slug?: string },
    actor: Actor,
  ) {
    const slug = input.slug ?? slugify(input.name);
    if (!slug)
      throw AppError.validation({
        issues: [{ path: 'name', message: 'Không tạo được slug từ tên này' }],
      });
    try {
      return await this.repo.db.transaction(async (c) => {
        const { rows } = await c.query(
          `INSERT INTO products (category_id, slug, name, summary, description, badge, color_code, style_code, sort_weight, seo_title, seo_description, is_customizable, hat_width_cm, hat_height_cm, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'DRAFT') RETURNING id`,
          [
            input.categoryId,
            slug,
            input.name,
            input.summary ?? null,
            input.description ?? null,
            input.badge ?? null,
            input.colorCode ?? null,
            input.styleCode ?? null,
            input.sortWeight ?? 0,
            input.seoTitle ?? null,
            input.seoDescription ?? null,
            input.isCustomizable,
            input.hatWidthCm ?? null,
            input.hatHeightCm ?? null,
          ],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'product.create',
            targetType: 'product',
            targetId: rows[0].id,
            metadata: { name: input.name, slug },
            requestId: actor.requestId,
          },
          c,
        );
        return (await this.repo.getDetail(c, rows[0].id, this.mediaBase))!;
      });
    } catch (e) {
      mapDbError(e, UNIQUE_MESSAGES);
    }
  }

  async updateProduct(
    id: string,
    input: Record<string, unknown> & { version: number; status?: string },
    actor: Actor,
  ) {
    const { version, ...fields } = input;
    try {
      return await this.repo.db.transaction(async (c) => {
        const before = await this.repo.lockProduct(c, id);
        if (!before) throw AppError.notFound('Không tìm thấy sản phẩm.');
        if (before.version !== version) {
          throw new AppError(
            'CONFLICT',
            409,
            'Sản phẩm đã được người khác chỉnh sửa. Vui lòng tải lại.',
            { currentVersion: before.version },
          );
        }
        const changes = diff(before, fields, PRODUCT_COLUMNS);
        const { sets, values } = buildSet(PRODUCT_COLUMNS, fields, 3);
        if (sets.length) {
          const publishing =
            fields.status === 'PUBLISHED' ? ', published_at = COALESCE(published_at, now())' : '';
          await c.query(
            `UPDATE products SET ${sets.join(', ')}${publishing}, version = version + 1, updated_at = now() WHERE id = $1 AND version = $2`,
            [id, version, ...values],
          );
          if (
            fields.status === 'PUBLISHED' ||
            (before.status === 'PUBLISHED' && fields.status === undefined)
          ) {
            const issues = await this.repo.publishIssues(c, id);
            if (issues.length)
              throw new AppError(
                'PUBLISH_REQUIREMENTS_NOT_MET',
                409,
                'Sản phẩm chưa đủ điều kiện để hiển thị.',
                { issues },
              );
          }
        }
        const statusChanged = changes.status;
        await this.audit.record(
          {
            actorId: actor.userId,
            action: statusChanged
              ? `product.${String(statusChanged.to).toLowerCase()}`
              : 'product.update',
            targetType: 'product',
            targetId: id,
            metadata: { changes },
            requestId: actor.requestId,
          },
          c,
        );
        return (await this.repo.getDetail(c, id, this.mediaBase))!;
      });
    } catch (e) {
      mapDbError(e, UNIQUE_MESSAGES);
    }
  }

  // ---- variants ---------------------------------------------------------------------------------

  private async assertStillPublishable(c: Queryable, productId: string) {
    const status = (await c.query('SELECT status FROM products WHERE id = $1', [productId])).rows[0]
      ?.status;
    if (status !== 'PUBLISHED') return;
    const issues = await this.repo.publishIssues(c, productId);
    if (issues.length)
      throw new AppError(
        'PUBLISH_REQUIREMENTS_NOT_MET',
        409,
        'Thay đổi này khiến sản phẩm đang bán không còn đủ điều kiện hiển thị.',
        { issues },
      );
  }

  async createVariant(
    productId: string,
    input: Record<string, unknown> & { sku: string; name: string; priceVnd: number },
    actor: Actor,
  ) {
    if (input.compareAtPriceVnd != null && (input.compareAtPriceVnd as number) <= input.priceVnd) {
      throw AppError.validation({
        issues: [{ path: 'compareAtPriceVnd', message: 'Giá gốc phải lớn hơn giá bán' }],
      });
    }
    try {
      return await this.repo.db.transaction(async (c) => {
        if (!(await this.repo.lockProduct(c, productId)))
          throw AppError.notFound('Không tìm thấy sản phẩm.');
        const pos = (
          await c.query(
            'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM product_variants WHERE product_id = $1',
            [productId],
          )
        ).rows[0].p;
        const { rows } = await c.query(
          `INSERT INTO product_variants (product_id, sku, name, price_vnd, compare_at_price_vnd, is_active, weight_grams, position)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            productId,
            input.sku,
            input.name,
            input.priceVnd,
            input.compareAtPriceVnd ?? null,
            input.isActive ?? true,
            input.weightGrams ?? null,
            pos,
          ],
        );
        await c.query(
          'UPDATE products SET version = version + 1, updated_at = now() WHERE id = $1',
          [productId],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'variant.create',
            targetType: 'variant',
            targetId: rows[0].id,
            metadata: { productId, sku: input.sku, priceVnd: input.priceVnd },
            requestId: actor.requestId,
          },
          c,
        );
        return (await this.repo.getDetail(c, productId, this.mediaBase))!;
      });
    } catch (e) {
      mapDbError(e, UNIQUE_MESSAGES);
    }
  }

  async updateVariant(variantId: string, input: Record<string, unknown>, actor: Actor) {
    try {
      return await this.repo.db.transaction(async (c) => {
        const found = (
          await c.query('SELECT product_id FROM product_variants WHERE id = $1', [variantId])
        ).rows[0];
        if (!found) throw AppError.notFound('Không tìm thấy biến thể.');
        await this.repo.lockProduct(c, found.product_id);
        const before = (
          await c.query('SELECT * FROM product_variants WHERE id = $1 FOR UPDATE', [variantId])
        ).rows[0];
        const nextPrice = (input.priceVnd as number | undefined) ?? Number(before.price_vnd);
        const nextCompare =
          input.compareAtPriceVnd !== undefined
            ? (input.compareAtPriceVnd as number | null)
            : before.compare_at_price_vnd === null
              ? null
              : Number(before.compare_at_price_vnd);
        if (nextCompare !== null && nextCompare <= nextPrice) {
          throw AppError.validation({
            issues: [{ path: 'compareAtPriceVnd', message: 'Giá gốc phải lớn hơn giá bán' }],
          });
        }
        const changes = diff(before, input, VARIANT_COLUMNS);
        const { sets, values } = buildSet(VARIANT_COLUMNS, input, 2);
        if (sets.length) {
          await c.query(
            `UPDATE product_variants SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
            [variantId, ...values],
          );
          await c.query(
            'UPDATE products SET version = version + 1, updated_at = now() WHERE id = $1',
            [found.product_id],
          );
          await this.assertStillPublishable(c, found.product_id);
        }
        const priceChanged = 'priceVnd' in changes || 'compareAtPriceVnd' in changes;
        await this.audit.record(
          {
            actorId: actor.userId,
            action: priceChanged ? 'variant.price_change' : 'variant.update',
            targetType: 'variant',
            targetId: variantId,
            metadata: { productId: found.product_id, sku: before.sku, changes },
            requestId: actor.requestId,
          },
          c,
        );
        return (await this.repo.getDetail(c, found.product_id, this.mediaBase))!;
      });
    } catch (e) {
      mapDbError(e, UNIQUE_MESSAGES);
    }
  }

  // ---- images -----------------------------------------------------------------------------------

  async uploadImage(
    productId: string,
    file: Buffer,
    alt: string | undefined,
    actor: Actor,
    variantId?: string,
  ) {
    const exists = await this.repo.db.query<{ name: string }>(
      'SELECT name FROM products WHERE id = $1',
      [productId],
    );
    if (!exists.rows[0]) throw AppError.notFound('Không tìm thấy sản phẩm.');
    if (variantId) {
      const v = await this.repo.db.query(
        'SELECT 1 FROM product_variants WHERE id = $1 AND product_id = $2',
        [variantId, productId],
      );
      if (!v.rows[0]) throw AppError.notFound('Không tìm thấy phiên bản sản phẩm.');
    }
    const processed = await this.images.processGallery(file, { fitToHat: Boolean(variantId) });
    const key = `products/${productId}/${randomUUID()}.webp`;
    await this.storage.put(key, processed.body, processed.contentType);
    const replaced: string[] = [];
    try {
      const detail = await this.repo.db.transaction(async (c) => {
        await this.repo.lockProduct(c, productId);
        // A variant has exactly one picture: uploading again replaces it.
        if (variantId) {
          const old = await c.query(
            'DELETE FROM product_images WHERE product_id = $1 AND variant_id = $2 RETURNING object_key',
            [productId, variantId],
          );
          replaced.push(...old.rows.map((r) => r.object_key as string));
        }
        const pos = (
          await c.query(
            'SELECT COALESCE(MAX(position), -1) + 1 AS p FROM product_images WHERE product_id = $1',
            [productId],
          )
        ).rows[0].p;
        const { rows } = await c.query(
          'INSERT INTO product_images (product_id, object_key, alt, width, height, position, variant_id) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
          [
            productId,
            key,
            (alt?.trim() || exists.rows[0]!.name).slice(0, 200),
            processed.width,
            processed.height,
            pos,
            variantId ?? null,
          ],
        );
        await c.query(
          'UPDATE products SET version = version + 1, updated_at = now() WHERE id = $1',
          [productId],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'image.upload',
            targetType: 'product',
            targetId: productId,
            metadata: { imageId: rows[0].id, key },
            requestId: actor.requestId,
          },
          c,
        );
        return (await this.repo.getDetail(c, productId, this.mediaBase))!;
      });
      for (const k of replaced) await this.storage.delete(k).catch(() => undefined);
      return detail;
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined); // do not orphan the object if the DB write failed
      throw error;
    }
  }

  async deleteImage(productId: string, imageId: string, actor: Actor) {
    const result = await this.repo.db.transaction(async (c) => {
      await this.repo.lockProduct(c, productId);
      const res = await c.query(
        'DELETE FROM product_images WHERE id = $1 AND product_id = $2 RETURNING object_key',
        [imageId, productId],
      );
      if (res.rowCount !== 1) throw AppError.notFound('Không tìm thấy ảnh.');
      await c.query('UPDATE products SET version = version + 1, updated_at = now() WHERE id = $1', [
        productId,
      ]);
      await this.assertStillPublishable(c, productId);
      await this.audit.record(
        {
          actorId: actor.userId,
          action: 'image.delete',
          targetType: 'product',
          targetId: productId,
          metadata: { imageId },
          requestId: actor.requestId,
        },
        c,
      );
      return {
        key: res.rows[0].object_key as string,
        detail: (await this.repo.getDetail(c, productId, this.mediaBase))!,
      };
    });
    await this.storage.delete(result.key).catch(() => undefined); // best effort after commit
    return result.detail;
  }

  async reorderImages(productId: string, imageIds: string[], actor: Actor) {
    return this.repo.db.transaction(async (c) => {
      await this.repo.lockProduct(c, productId);
      const current = (
        await c.query('SELECT id FROM product_images WHERE product_id = $1', [productId])
      ).rows.map((r) => r.id as string);
      if (
        current.length !== imageIds.length ||
        new Set(imageIds).size !== imageIds.length ||
        !imageIds.every((i) => current.includes(i))
      ) {
        throw AppError.validation({
          issues: [{ path: 'imageIds', message: 'Danh sách ảnh phải gồm đúng tất cả ảnh hiện có' }],
        });
      }
      for (const [position, id] of imageIds.entries())
        await c.query('UPDATE product_images SET position = $1 WHERE id = $2', [position, id]);
      await c.query('UPDATE products SET version = version + 1, updated_at = now() WHERE id = $1', [
        productId,
      ]);
      await this.audit.record(
        {
          actorId: actor.userId,
          action: 'image.reorder',
          targetType: 'product',
          targetId: productId,
          metadata: { imageIds },
          requestId: actor.requestId,
        },
        c,
      );
      return (await this.repo.getDetail(c, productId, this.mediaBase))!;
    });
  }
}
