import { Inject, Injectable } from '@nestjs/common';
import type { AdminArticle, ArticleDto, ArticleStatus, ArticleSummary } from '@nona/contracts';
import { articlePublishIssues } from '@nona/contracts';
import { DatabaseService } from '../../../platform/database/database.service';

export interface Row {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  body: string;
  cover_key: string | null;
  cover_alt: string;
  cover_width: number | null;
  cover_height: number | null;
  status: ArticleStatus;
  author_name: string | null;
  seo_title: string | null;
  seo_description: string | null;
  published_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `SELECT a.*, u.full_name AS author_name FROM articles a LEFT JOIN users u ON u.id = a.author_id`;
const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Injectable()
export class ArticlesRepository {
  constructor(@Inject(DatabaseService) readonly db: DatabaseService) {}

  cover(r: Row, mediaBase: string) {
    return r.cover_key && r.cover_width && r.cover_height
      ? {
          url: `${mediaBase}/${r.cover_key}`,
          alt: r.cover_alt,
          width: r.cover_width,
          height: r.cover_height,
        }
      : null;
  }

  summary(r: Row, mediaBase: string): ArticleSummary {
    return {
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      cover: this.cover(r, mediaBase),
      publishedAt: r.published_at!.toISOString(),
      authorName: r.author_name,
    };
  }
  full(r: Row, mediaBase: string): ArticleDto {
    return {
      ...this.summary(r, mediaBase),
      body: r.body,
      seoTitle: r.seo_title,
      seoDescription: r.seo_description,
      updatedAt: r.updated_at.toISOString(),
    };
  }
  admin(r: Row, mediaBase: string): AdminArticle {
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      excerpt: r.excerpt,
      body: r.body,
      status: r.status,
      cover: this.cover(r, mediaBase),
      authorName: r.author_name,
      seoTitle: r.seo_title,
      seoDescription: r.seo_description,
      publishedAt: iso(r.published_at),
      version: r.version,
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
      publishIssues: articlePublishIssues({
        title: r.title,
        body: r.body,
        hasCover: Boolean(r.cover_key),
      }),
    };
  }

  async listPublished(page: number, pageSize: number) {
    const { rows } = await this.db.query<Row & { total: string }>(
      `${SELECT.replace('SELECT a.*,', 'SELECT a.*, COUNT(*) OVER() AS total,')}
       WHERE a.status = 'PUBLISHED' ORDER BY a.published_at DESC, a.id LIMIT $1 OFFSET $2`,
      [pageSize, (page - 1) * pageSize],
    );
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }
  async published(slug: string) {
    const { rows } = await this.db.query<Row>(
      `${SELECT} WHERE a.slug = $1 AND a.status = 'PUBLISHED'`,
      [slug],
    );
    return rows[0] ?? null;
  }
  async listAll(filter: { status?: string; q?: string }, page: number, pageSize: number) {
    const where: string[] = [];
    const values: unknown[] = [];
    const p = (x: unknown) => (values.push(x), `$${values.length}`);
    if (filter.status) where.push(`a.status = ${p(filter.status)}`);
    if (filter.q) {
      const like = p(`%${filter.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      where.push(
        `(unaccent(lower(a.title)) LIKE unaccent(lower(${like})) OR a.slug LIKE lower(${like}))`,
      );
    }
    const limit = p(pageSize);
    const offset = p((page - 1) * pageSize);
    const { rows } = await this.db.query<Row & { total: string }>(
      `${SELECT.replace('SELECT a.*,', 'SELECT a.*, COUNT(*) OVER() AS total,')}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY a.updated_at DESC, a.id LIMIT ${limit} OFFSET ${offset}`,
      values,
    );
    return { rows, total: rows[0] ? Number(rows[0].total) : 0 };
  }
  async byId(id: string, q: { query: DatabaseService['query'] } = this.db) {
    const { rows } = await q.query<Row>(`${SELECT} WHERE a.id = $1`, [id]);
    return rows[0] ?? null;
  }
}
