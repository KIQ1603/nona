import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  adminArticleListSchema,
  adminArticleSchema,
  articleListSchema,
  articleSchema,
} from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE } from '../src/modules/media/domain';
import type { MemoryStorage } from '../src/modules/media/infrastructure/memory-storage';
import { as, bootApp, createUser, login, png, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
const storage = () => app.get<MemoryStorage>(OBJECT_STORAGE);
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  storage().objects.clear();
});

const staff = async (role: 'ADMIN' | 'CATALOG' | 'FULFILLMENT' | 'SUPPORT' | 'FINANCE') =>
  as(app, await login(app, (await createUser(pool, role)).email));
const pub = (path: string) => request(app.getHttpServer()).get(path);
type Api = Awaited<ReturnType<typeof staff>>;

async function draft(api: Api, over: object = {}) {
  const res = await api.post('/v1/admin/articles').send({
    title: 'Nón lá và mùa mưa',
    body: '## Mở đầu\n\nNội dung bài viết.',
    excerpt: 'Tóm tắt',
    ...over,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return adminArticleSchema.parse(res.body);
}
const withCover = async (api: Api, id: string, size = 800) =>
  adminArticleSchema.parse(
    (
      await api
        .post(`/v1/admin/articles/${id}/cover`)
        .field('alt', 'Ảnh bìa')
        .attach('file', await png(size), 'c.png')
        .expect(201)
    ).body,
  );
const publish = (api: Api, a: { id: string; version: number }) =>
  api.patch(`/v1/admin/articles/${a.id}`).send({ version: a.version, status: 'PUBLISHED' });

describe('writing and publishing', () => {
  it('creates a draft with an auto slug, hidden from the public until it is complete and published', async () => {
    const api = await staff('ADMIN');
    const a = await draft(api);
    expect(a).toMatchObject({
      slug: 'non-la-va-mua-mua',
      status: 'DRAFT',
      publishedAt: null,
      version: 1,
    });
    expect(a.publishIssues).toEqual(['Cần có ảnh bìa']);
    expect((await pub('/v1/articles/non-la-va-mua-mua')).status).toBe(404);
    expect(articleListSchema.parse((await pub('/v1/articles')).body).items).toHaveLength(0);

    const blocked = await publish(api, a);
    expect(blocked.status).toBe(400);
    expect(JSON.stringify(blocked.body)).toContain('ảnh bìa');

    const covered = await withCover(api, a.id);
    expect(covered.cover).toMatchObject({ alt: 'Ảnh bìa' });
    expect(storage().objects.size).toBe(1);
    const published = adminArticleSchema.parse((await publish(api, covered)).body);
    expect(published).toMatchObject({ status: 'PUBLISHED', publishIssues: [] });
    expect(published.publishedAt).not.toBeNull();

    const one = articleSchema.parse((await pub('/v1/articles/non-la-va-mua-mua')).body);
    expect(one).toMatchObject({ title: 'Nón lá và mùa mưa', excerpt: 'Tóm tắt' });
    expect(one.body).toContain('## Mở đầu');
    expect(one.cover!.url).toContain('/articles/');
    const list = articleListSchema.parse((await pub('/v1/articles')).body);
    expect(list.items.map((i) => i.slug)).toEqual(['non-la-va-mua-mua']);
    expect(list.meta.total).toBe(1);
  });

  it('refuses to publish without a title or content, and the database enforces the same', async () => {
    const api = await staff('ADMIN');
    const a = await draft(api, { body: '' });
    await withCover(api, a.id);
    const v = (await api.get(`/v1/admin/articles/${a.id}`)).body.version;
    const res = await publish(api, { id: a.id, version: v });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain('nội dung');
    await expect(
      pool.query(`UPDATE articles SET status = 'PUBLISHED', published_at = now() WHERE id = $1`, [
        a.id,
      ]),
    ).rejects.toThrow(/articles_published_complete/);
  });

  it('keeps the first publication date, hides unpublished/archived posts and orders newest first', async () => {
    const api = await staff('ADMIN');
    const make = async (title: string) => {
      const a = await withCover(api, (await draft(api, { title })).id);
      return adminArticleSchema.parse((await publish(api, a)).body);
    };
    const first = await make('Bài một');
    await pool.query(`UPDATE articles SET published_at = now() - interval '2 days' WHERE id = $1`, [
      first.id,
    ]);
    const dated = (await api.get(`/v1/admin/articles/${first.id}`)).body.publishedAt as string;
    const second = await make('Bài hai');
    expect(
      articleListSchema.parse((await pub('/v1/articles')).body).items.map((i) => i.title),
    ).toEqual(['Bài hai', 'Bài một']);

    const v1 = (await api.get(`/v1/admin/articles/${first.id}`)).body.version;
    const back = adminArticleSchema.parse(
      (await api.patch(`/v1/admin/articles/${first.id}`).send({ version: v1, status: 'DRAFT' }))
        .body,
    );
    expect(back.status).toBe('DRAFT');
    expect((await pub(`/v1/articles/${first.slug}`)).status).toBe(404);
    const again = adminArticleSchema.parse((await publish(api, back)).body);
    expect(again.publishedAt).toBe(dated); // the original publication date is kept

    const v2 = (await api.get(`/v1/admin/articles/${second.id}`)).body.version;
    const arch = await api
      .patch(`/v1/admin/articles/${second.id}`)
      .send({ version: v2, status: 'ARCHIVED' });
    expect(arch.status).toBe(200);
    expect(
      articleListSchema.parse((await pub('/v1/articles')).body).items.map((i) => i.title),
    ).toEqual(['Bài một']);
    const actions = (
      await pool.query(
        `SELECT action FROM audit_logs WHERE target_type = 'article' ORDER BY created_at, id`,
      )
    ).rows.map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'article.create',
        'article.cover',
        'article.publish',
        'article.unpublish',
        'article.archive',
      ]),
    );
  });

  it('paginates the public list', async () => {
    const api = await staff('ADMIN');
    for (const t of ['A', 'B', 'C']) {
      const a = await withCover(api, (await draft(api, { title: `Bài ${t}` })).id);
      await publish(api, a);
    }
    const p1 = articleListSchema.parse((await pub('/v1/articles?pageSize=2')).body);
    expect(p1.items).toHaveLength(2);
    expect(p1.meta).toMatchObject({ page: 1, pageSize: 2, total: 3 });
    expect(
      articleListSchema.parse((await pub('/v1/articles?pageSize=2&page=2')).body).items,
    ).toHaveLength(1);
    expect((await pub('/v1/articles?pageSize=500')).status).toBe(400);
  });
});

describe('editing safely', () => {
  it('detects concurrent edits through the version, and slugs must stay unique', async () => {
    const api = await staff('ADMIN');
    const a = await draft(api);
    const b = await draft(api, { title: 'Bài khác' });
    const ok = await api
      .patch(`/v1/admin/articles/${a.id}`)
      .send({ version: 1, title: 'Tiêu đề mới', excerpt: 'Mới' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ title: 'Tiêu đề mới', version: 2 });
    const stale = await api.patch(`/v1/admin/articles/${a.id}`).send({ version: 1, title: 'Cũ' });
    expect(stale.status).toBe(409);
    expect(
      (await api.patch(`/v1/admin/articles/${b.id}`).send({ version: 1, slug: a.slug })).status,
    ).toBe(409);
    expect(
      (await api.post('/v1/admin/articles').send({ title: 'Trùng', slug: a.slug })).status,
    ).toBe(409);
    expect(
      (await api.patch(`/v1/admin/articles/${b.id}`).send({ version: 1, slug: 'Bad Slug!' }))
        .status,
    ).toBe(400);
    expect(
      (await api.patch(`/v1/admin/articles/${b.id}`).send({ version: 1, surprise: true })).status,
    ).toBe(400);
    expect((await api.post('/v1/admin/articles').send({ title: '' })).status).toBe(400);
  });

  it('stores HTML-looking text verbatim (the web renderer escapes it) and never accepts raw status via create', async () => {
    const api = await staff('ADMIN');
    const a = await draft(api, {
      title: '<img src=x onerror=alert(1)>',
      body: '<script>alert(1)</script>',
    });
    expect(a.body).toBe('<script>alert(1)</script>');
    expect(
      (await api.post('/v1/admin/articles').send({ title: 'x', status: 'PUBLISHED' })).status,
    ).toBe(400);
  });

  it('deletes only unpublished posts, and removes their cover file', async () => {
    const api = await staff('ADMIN');
    const a = await withCover(api, (await draft(api)).id);
    const live = adminArticleSchema.parse((await publish(api, a)).body);
    expect((await api.delete(`/v1/admin/articles/${live.id}`)).status).toBe(409);
    expect((await api.delete(`/v1/admin/articles/${live.id}/cover`)).status).toBe(409);
    await api
      .patch(`/v1/admin/articles/${live.id}`)
      .send({ version: live.version, status: 'DRAFT' })
      .expect(200);
    expect(storage().objects.size).toBe(1);
    expect((await api.delete(`/v1/admin/articles/${live.id}`)).status).toBe(204);
    expect(storage().objects.size).toBe(0);
    expect((await api.get(`/v1/admin/articles/${live.id}`)).status).toBe(404);
    expect(
      (await pool.query(`SELECT 1 FROM audit_logs WHERE action = 'article.delete'`)).rowCount,
    ).toBe(1);
  });
});

describe('images', () => {
  it('replaces a cover (old file deleted), validates uploads, and stores body images re-encoded', async () => {
    const api = await staff('ADMIN');
    const a = await draft(api);
    const c1 = await withCover(api, a.id);
    const key1 = (await pool.query('SELECT cover_key FROM articles')).rows[0].cover_key as string;
    await withCover(api, a.id, 900);
    expect(storage().objects.has(key1)).toBe(false);
    expect(storage().objects.size).toBe(1);
    expect(c1.cover).not.toBeNull();

    const bad = await api
      .post(`/v1/admin/articles/${a.id}/cover`)
      .attach('file', Buffer.from('not an image'), 'x.png');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MEDIA_INVALID');
    expect(
      (
        await api
          .post(`/v1/admin/articles/${a.id}/cover`)
          .attach('file', await png(300), 'small.png')
      ).status,
    ).toBe(400); // too small for a cover
    expect((await api.post(`/v1/admin/articles/${a.id}/cover`).send({})).status).toBe(400);

    const img = await api
      .post('/v1/admin/articles/images')
      .attach('file', await png(900), 'body.png');
    expect(img.status).toBe(201);
    expect(img.body.url).toMatch(/\/articles\/body\/[0-9a-f-]+\.webp$/);
    const key = (img.body.url as string).split('/media/')[1]!;
    expect(storage().objects.get(key)!.body.subarray(8, 12).toString()).toBe('WEBP');
  });
});

describe('permissions', () => {
  it('lets ADMIN and CATALOG write; everyone else is refused, and the public cannot read drafts', async () => {
    const admin = await staff('ADMIN');
    const a = await draft(admin);
    for (const role of ['SUPPORT', 'FULFILLMENT', 'FINANCE'] as const) {
      const api = await staff(role);
      expect((await api.get('/v1/admin/articles')).status, role).toBe(403);
      expect((await api.post('/v1/admin/articles').send({ title: 'x' })).status, role).toBe(403);
      expect(
        (await api.patch(`/v1/admin/articles/${a.id}`).send({ version: 1, title: 'x' })).status,
        role,
      ).toBe(403);
      expect((await api.delete(`/v1/admin/articles/${a.id}`)).status, role).toBe(403);
    }
    expect((await request(app.getHttpServer()).get('/v1/admin/articles')).status).toBe(401);
    const catalog = await staff('CATALOG');
    expect(
      (await catalog.post('/v1/admin/articles').send({ title: 'Của biên tập viên' })).status,
    ).toBe(201);
    const list = adminArticleListSchema.parse((await admin.get('/v1/admin/articles')).body);
    expect(list.items).toHaveLength(2);
    expect(
      adminArticleListSchema.parse((await admin.get('/v1/admin/articles?q=bien%20tap')).body).items,
    ).toHaveLength(1);
    expect(
      adminArticleListSchema.parse((await admin.get('/v1/admin/articles?status=PUBLISHED')).body)
        .items,
    ).toHaveLength(0);
    expect((await admin.get('/v1/admin/articles?status=BOGUS')).status).toBe(400);
    expect((await pub(`/v1/articles/${a.slug}`)).status).toBe(404);
  });
});
