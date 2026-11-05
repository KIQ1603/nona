import type { NestExpressApplication } from '@nestjs/platform-express';
import { pageImagesSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, bootApp, createUser, login, png, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query(
    `INSERT INTO site_settings (key, value, version) VALUES ('pages', '{"homeTypes": {}, "homeAbout": null, "aboutGallery": [], "aboutValues": []}'::jsonb, 1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = 1`,
  );
});
const admin = async () => as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
const publicPages = async () =>
  pageImagesSchema.parse((await request(app.getHttpServer()).get('/v1/storefront/pages')).body);

describe('page pictures chosen in the admin', () => {
  it('shows nothing custom until the admin chooses pictures', async () => {
    const p = await publicPages();
    expect(p.homeAbout).toBeNull();
    expect(p.homeTypes).toEqual({});
    expect(p.aboutGallery).toEqual([null, null, null]);
    expect(p.aboutValues).toEqual([null, null, null, null]);
  });

  it('uploads a picture, saves it in a slot, and the storefront serves its URL', async () => {
    const api = await admin();
    const up = await api.post('/v1/admin/pages/image').attach('file', await png(800), 'a.png');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    expect(up.body.imageKey).toMatch(/^pages\/[a-f0-9-]{36}\.webp$/);
    expect(up.body.imageUrl).toBe(`https://cdn.test/media/${up.body.imageKey}`);

    const saved = await api.patch('/v1/admin/settings/pages').send({
      version: 1,
      value: {
        homeTypes: { 'non-la': up.body.imageKey },
        homeAbout: up.body.imageKey,
        aboutGallery: [null, up.body.imageKey, null],
        aboutValues: [up.body.imageKey, null, null, null],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const p = await publicPages();
    expect(p.homeTypes['non-la']).toBe(up.body.imageUrl);
    expect(p.homeAbout).toBe(up.body.imageUrl);
    expect(p.aboutGallery).toEqual([null, up.body.imageUrl, null]);
    expect(p.aboutValues).toEqual([up.body.imageUrl, null, null, null]);
    // the change is audited
    const audit = await pool.query("SELECT 1 FROM audit_logs WHERE action = 'pages.image_upload'");
    expect(audit.rowCount).toBe(1);
  });

  it('refuses keys that did not come from an upload, a wrong slot count, and non-images', async () => {
    const api = await admin();
    const patch = (value: object) =>
      api.patch('/v1/admin/settings/pages').send({ version: 1, value });
    const base = { homeTypes: {}, homeAbout: null, aboutGallery: [], aboutValues: [] };
    expect((await patch({ ...base, homeAbout: 'https://evil.test/x.webp' })).status).toBe(400);
    expect((await patch({ ...base, homeAbout: 'products/../secret.webp' })).status).toBe(400);
    expect((await patch({ ...base, aboutGallery: [null, null, null, null] })).status).toBe(400);
    const bad = await api
      .post('/v1/admin/pages/image')
      .attach('file', Buffer.from('not an image'), 'x.png');
    expect(bad.status).toBe(400);
  });

  it('is limited to staff who may change settings', async () => {
    const support = as(app, await login(app, (await createUser(pool, 'SUPPORT')).email));
    expect(
      (await support.post('/v1/admin/pages/image').attach('file', await png(800), 'a.png')).status,
    ).toBe(403);
    expect(
      (
        await support
          .patch('/v1/admin/settings/pages')
          .send({ version: 1, value: { homeTypes: {} } })
      ).status,
    ).toBe(403);
    const anon = await request(app.getHttpServer())
      .post('/v1/admin/pages/image')
      .attach('file', await png(800), 'a.png');
    expect([401, 403]).toContain(anon.status);
  });
});
