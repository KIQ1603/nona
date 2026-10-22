import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminSettingsSchema, landingSettingSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, bootApp, createUser, login, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => resetAll(pool, app));

const content = {
  hero: {
    eyebrow: 'x',
    titleTop: 'Nón Lá',
    titleAccent: 'Hồn Việt',
    text: 'Mô tả',
    primaryCta: 'Xem',
    secondaryCta: 'Câu chuyện',
  },
  story: {
    eyebrow: 'Câu chuyện',
    title: { before: 'Mỗi chiếc nón là một', accent: 'bài thơ', after: 'đan bằng tay' },
    text: 't',
    bigWord: '70',
    badgeText: 'NÓN LÁ',
    imageUrl: 'https://example.com/a.jpg',
    imageAlt: 'a',
    stats: [{ value: 70, suffix: '+', label: 'năm' }],
  },
  process: {
    eyebrow: 'Quy trình',
    title: { before: 'Từ lá', accent: 'đến nón', after: '' },
    steps: [{ icon: '🌿', title: 'Hái lá', text: 'x', duration: '2 ngày' }],
  },
  testimonials: {
    eyebrow: 'Khách hàng',
    items: [
      {
        quote: 'Đẹp',
        name: 'A',
        where: 'Hà Nội',
        imageUrl: 'https://example.com/b.jpg',
        caption: 'c',
      },
    ],
  },
  order: {
    eyebrow: 'Đặt hàng',
    titleTop: 'Đội nón Việt,',
    titleAccent: 'mang hồn quê',
    titleBottom: 'đi xa',
    text: 't',
  },
};

describe('landing content (admin-managed)', () => {
  it('serves a safe skeleton before anything is saved, then the saved content publicly', async () => {
    const empty = await request(app.getHttpServer()).get('/v1/storefront/landing');
    expect(empty.status).toBe(200);
    expect(landingSettingSchema.safeParse(empty.body).success).toBe(true);
    const admin = as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
    const s = (await admin.get('/v1/admin/settings')).body;
    expect(adminSettingsSchema.safeParse(s).success).toBe(true);
    const put = (value: object) =>
      admin.patch('/v1/admin/settings/landing').send({ version: s.landing.version, value });
    const saved = await put(content);
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const pub = (await request(app.getHttpServer()).get('/v1/storefront/landing')).body;
    expect(pub.hero.titleAccent).toBe('Hồn Việt');
    expect(pub.testimonials.items).toHaveLength(1);
  });
  it('rejects unsafe image links, unknown fields and oversize lists; needs settings:write', async () => {
    const admin = as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
    const v = (await admin.get('/v1/admin/settings')).body.landing.version;
    const put = (value: object) =>
      admin.patch('/v1/admin/settings/landing').send({ version: v, value });
    expect(
      (await put({ ...content, story: { ...content.story, imageUrl: 'javascript:alert(1)' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await put({
          ...content,
          story: { ...content.story, imageUrl: 'http://insecure.example/a.jpg' },
        })
      ).status,
    ).toBe(400);
    expect((await put({ ...content, hero: { ...content.hero, surprise: 1 } })).status).toBe(400);
    expect(
      (
        await put({
          ...content,
          process: {
            ...content.process,
            steps: Array.from({ length: 9 }, () => content.process.steps[0]),
          },
        })
      ).status,
    ).toBe(400);
    const catalog = as(app, await login(app, (await createUser(pool, 'CATALOG')).email));
    expect(
      (await catalog.patch('/v1/admin/settings/landing').send({ version: v, value: content }))
        .status,
    ).toBe(403);
  });
});
