import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  articlePublishIssues,
  type AdminArticle,
  type ArticleDto,
  type CreateArticleInput,
  type UpdateArticleInput,
} from '@nona/contracts';
import { slugify } from '../../../common/slug';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { ImageProcessor } from '../../media/application/image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from '../../media/domain';
import { ArticlesRepository } from '../infrastructure/articles.repository';

interface Actor {
  userId: string;
  requestId?: string;
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505';
const SLUG_TAKEN = () => new AppError('CONFLICT', 409, 'Slug này đã được dùng cho bài viết khác.');

@Injectable()
export class ArticlesService {
  private readonly mediaBase: string;
  constructor(
    @Inject(ArticlesRepository) private readonly repo: ArticlesRepository,
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  // ---- public ------------------------------------------------------------------------------------

  async listPublished(page: number, pageSize: number) {
    const { rows, total } = await this.repo.listPublished(page, pageSize);
    return {
      items: rows.map((r) => this.repo.summary(r, this.mediaBase)),
      meta: { page, pageSize, total },
    };
  }
  async published(slug: string): Promise<ArticleDto> {
    const row = await this.repo.published(slug);
    if (!row) throw AppError.notFound('Không tìm thấy bài viết.');
    return this.repo.full(row, this.mediaBase);
  }

  // ---- admin -------------------------------------------------------------------------------------

  async listAdmin(filter: { status?: string; q?: string }, page: number, pageSize: number) {
    const { rows, total } = await this.repo.listAll(filter, page, pageSize);
    return {
      items: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        title: r.title,
        status: r.status,
        coverUrl: this.repo.cover(r, this.mediaBase)?.url ?? null,
        publishedAt: r.published_at ? r.published_at.toISOString() : null,
        updatedAt: r.updated_at.toISOString(),
        authorName: r.author_name,
      })),
      meta: { page, pageSize, total },
    };
  }
  async detail(id: string): Promise<AdminArticle> {
    const row = await this.repo.byId(id);
    if (!row) throw AppError.notFound('Không tìm thấy bài viết.');
    return this.repo.admin(row, this.mediaBase);
  }

  async create(input: CreateArticleInput, actor: Actor): Promise<AdminArticle> {
    const slug = input.slug ?? slugify(input.title);
    if (!slug)
      throw AppError.validation({
        issues: [{ path: 'title', message: 'Không tạo được slug từ tiêu đề này' }],
      });
    try {
      const id = await this.db.transaction(async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `INSERT INTO articles (slug, title, excerpt, body, cover_alt, seo_title, seo_description, author_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [
            slug,
            input.title,
            input.excerpt,
            input.body,
            input.coverAlt,
            input.seoTitle ?? null,
            input.seoDescription ?? null,
            actor.userId,
          ],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'article.create',
            targetType: 'article',
            targetId: rows[0]!.id,
            metadata: { slug, title: input.title },
            requestId: actor.requestId,
          },
          c,
        );
        return rows[0]!.id;
      });
      return this.detail(id);
    } catch (e) {
      if (isUnique(e)) throw SLUG_TAKEN();
      throw e;
    }
  }

  async update(id: string, input: UpdateArticleInput, actor: Actor): Promise<AdminArticle> {
    const { version, status, ...fields } = input;
    try {
      await this.db.transaction(async (c) => {
        const before = await c.query<{
          version: number;
          status: string;
          title: string;
          body: string;
          cover_key: string | null;
        }>(
          'SELECT version, status, title, body, cover_key FROM articles WHERE id = $1 FOR UPDATE',
          [id],
        );
        const b = before.rows[0];
        if (!b) throw AppError.notFound('Không tìm thấy bài viết.');
        if (b.version !== version)
          throw new AppError(
            'CONFLICT',
            409,
            'Bài viết vừa được chỉnh sửa ở nơi khác. Hãy tải lại trang.',
            { currentVersion: b.version },
          );

        const next = {
          title: fields.title ?? b.title,
          body: fields.body ?? b.body,
        };
        if (status === 'PUBLISHED') {
          const issues = articlePublishIssues({
            title: next.title,
            body: next.body,
            hasCover: Boolean(b.cover_key),
          });
          if (issues.length)
            throw AppError.validation({
              issues: issues.map((message) => ({ path: 'status', message })),
            });
        }

        const sets: string[] = [];
        const values: unknown[] = [];
        const set = (col: string, v: unknown) => (
          values.push(v),
          sets.push(`${col} = $${values.length + 2}`)
        );
        if (fields.title !== undefined) set('title', fields.title);
        if (fields.slug !== undefined) set('slug', fields.slug);
        if (fields.excerpt !== undefined) set('excerpt', fields.excerpt);
        if (fields.body !== undefined) set('body', fields.body);
        if (fields.coverAlt !== undefined) set('cover_alt', fields.coverAlt);
        if (fields.seoTitle !== undefined) set('seo_title', fields.seoTitle);
        if (fields.seoDescription !== undefined) set('seo_description', fields.seoDescription);
        if (status !== undefined) {
          set('status', status);
          // the first publication fixes the public date; republishing keeps it
          if (status === 'PUBLISHED') sets.push('published_at = COALESCE(published_at, now())');
        }
        await c.query(
          `UPDATE articles SET ${[...sets, 'version = version + 1', 'updated_at = now()'].join(', ')} WHERE id = $1 AND version = $2`,
          [id, version, ...values],
        );
        const action =
          status && status !== b.status
            ? status === 'PUBLISHED'
              ? 'article.publish'
              : status === 'ARCHIVED'
                ? 'article.archive'
                : 'article.unpublish'
            : 'article.update';
        await this.audit.record(
          {
            actorId: actor.userId,
            action,
            targetType: 'article',
            targetId: id,
            metadata: { fields: Object.keys(fields), status: status ?? null },
            requestId: actor.requestId,
          },
          c,
        );
      });
    } catch (e) {
      if (isUnique(e)) throw SLUG_TAKEN();
      throw e;
    }
    return this.detail(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    await this.db.transaction(async (c) => {
      const { rows } = await c.query<{ status: string; slug: string; cover_key: string | null }>(
        'SELECT status, slug, cover_key FROM articles WHERE id = $1 FOR UPDATE',
        [id],
      );
      const a = rows[0];
      if (!a) throw AppError.notFound('Không tìm thấy bài viết.');
      if (a.status === 'PUBLISHED')
        throw new AppError(
          'CONFLICT',
          409,
          'Hãy gỡ bài viết xuống (nháp hoặc lưu trữ) trước khi xóa.',
        );
      await c.query('DELETE FROM articles WHERE id = $1', [id]);
      await this.audit.record(
        {
          actorId: actor.userId,
          action: 'article.delete',
          targetType: 'article',
          targetId: id,
          metadata: { slug: a.slug },
          requestId: actor.requestId,
        },
        c,
      );
      if (a.cover_key) await this.storage.delete(a.cover_key).catch(() => undefined);
    });
  }

  async setCover(
    id: string,
    file: Buffer,
    alt: string | undefined,
    actor: Actor,
  ): Promise<AdminArticle> {
    const exists = await this.repo.byId(id);
    if (!exists) throw AppError.notFound('Không tìm thấy bài viết.');
    const processed = await this.images.process(file, { minSide: 600, maxSide: 2000 });
    const key = `articles/${id}/${randomUUID()}.webp`;
    await this.storage.put(key, processed.body, processed.contentType);
    try {
      await this.db.transaction(async (c) => {
        await c.query(
          `UPDATE articles SET cover_key = $2, cover_width = $3, cover_height = $4,
             cover_alt = CASE WHEN $5::text <> '' THEN $5 ELSE cover_alt END,
             version = version + 1, updated_at = now() WHERE id = $1`,
          [id, key, processed.width, processed.height, (alt ?? '').trim().slice(0, 200)],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'article.cover',
            targetType: 'article',
            targetId: id,
            metadata: { key },
            requestId: actor.requestId,
          },
          c,
        );
      });
    } catch (e) {
      await this.storage.delete(key).catch(() => undefined);
      throw e;
    }
    if (exists.cover_key) await this.storage.delete(exists.cover_key).catch(() => undefined);
    return this.detail(id);
  }

  async removeCover(id: string, actor: Actor): Promise<AdminArticle> {
    await this.db.transaction(async (c) => {
      const { rows } = await c.query<{ status: string; cover_key: string | null }>(
        'SELECT status, cover_key FROM articles WHERE id = $1 FOR UPDATE',
        [id],
      );
      const a = rows[0];
      if (!a) throw AppError.notFound('Không tìm thấy bài viết.');
      if (a.status === 'PUBLISHED')
        throw new AppError(
          'CONFLICT',
          409,
          'Bài viết đang đăng phải có ảnh bìa. Hãy thay ảnh khác hoặc gỡ bài xuống trước.',
        );
      await c.query(
        'UPDATE articles SET cover_key = NULL, cover_width = NULL, cover_height = NULL, version = version + 1, updated_at = now() WHERE id = $1',
        [id],
      );
      await this.audit.record(
        {
          actorId: actor.userId,
          action: 'article.cover_remove',
          targetType: 'article',
          targetId: id,
          requestId: actor.requestId,
        },
        c,
      );
      if (a.cover_key) await this.storage.delete(a.cover_key).catch(() => undefined);
    });
    return this.detail(id);
  }

  /** An image to embed in the body: stored re-encoded, returned as a URL to paste as ![alt](url). */
  async uploadBodyImage(file: Buffer, actor: Actor) {
    const processed = await this.images.process(file, { minSide: 200, maxSide: 1800 });
    const key = `articles/body/${randomUUID()}.webp`;
    await this.storage.put(key, processed.body, processed.contentType);
    await this.audit.record({
      actorId: actor.userId,
      action: 'article.image',
      targetType: 'article',
      metadata: { key },
      requestId: actor.requestId,
    });
    return { url: `${this.mediaBase}/${key}`, width: processed.width, height: processed.height };
  }
}
