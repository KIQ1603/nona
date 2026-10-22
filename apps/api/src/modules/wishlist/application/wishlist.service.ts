import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../platform/database/database.service';

const MAX_ITEMS = 200;

@Injectable()
export class WishlistService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async slugs(userId: string) {
    const { rows } = await this.db.query<{ slug: string }>(
      `SELECT p.slug FROM wishlist_items w JOIN products p ON p.id = w.product_id
       WHERE w.user_id = $1 AND p.status = 'PUBLISHED' ORDER BY w.created_at DESC`,
      [userId],
    );
    return { slugs: rows.map((r) => r.slug) };
  }

  async add(userId: string, slug: string) {
    const res = await this.db.query(
      `INSERT INTO wishlist_items (user_id, product_id) SELECT $1, id FROM products WHERE slug = $2 AND status = 'PUBLISHED'
       ON CONFLICT DO NOTHING`,
      [userId, slug],
    );
    if (res.rowCount === 0) {
      const exists = await this.db.query(
        `SELECT 1 FROM products WHERE slug = $1 AND status = 'PUBLISHED'`,
        [slug],
      );
      if (!exists.rowCount) throw AppError.notFound('Không tìm thấy sản phẩm.');
    }
    return this.slugs(userId);
  }

  async remove(userId: string, slug: string) {
    await this.db.query(
      'DELETE FROM wishlist_items WHERE user_id = $1 AND product_id IN (SELECT id FROM products WHERE slug = $2)',
      [userId, slug],
    );
    return this.slugs(userId);
  }

  /** Imports favourites kept in the browser while signed out. Unknown/unpublished slugs are ignored. */
  async merge(userId: string, slugs: string[]) {
    if (slugs.length) {
      await this.db.query(
        `INSERT INTO wishlist_items (user_id, product_id)
         SELECT $1, id FROM products WHERE slug = ANY($2::text[]) AND status = 'PUBLISHED'
           AND (SELECT COUNT(*) FROM wishlist_items WHERE user_id = $1) < ${MAX_ITEMS}
         ON CONFLICT DO NOTHING`,
        [userId, slugs],
      );
    }
    return this.slugs(userId);
  }
}
