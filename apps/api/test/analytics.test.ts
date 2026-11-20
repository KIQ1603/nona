import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminAnalyticsSchema, adminUserListSchema } from '@nona/contracts';
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

const staff = async (role: 'ADMIN' | 'SUPPORT') =>
  as(app, await login(app, (await createUser(pool, role)).email));
const visitor = (n: number) => `visitor-${String(n).padStart(12, '0')}`;
const track = (body: Record<string, unknown>) =>
  request(app.getHttpServer()).post('/v1/analytics/events').send(body);

describe('storefront tracking', () => {
  it('records anonymous page and product views, ignoring admin paths and own-site referrers', async () => {
    expect((await track({ visitorId: visitor(1), path: '/' })).status).toBe(204);
    expect(
      (
        await track({
          visitorId: visitor(1),
          path: '/san-pham/non-la',
          referrer: 'https://www.google.com/search?q=x',
        })
      ).status,
    ).toBe(204);
    await track({ visitorId: visitor(2), path: '/admin/orders' });
    await track({ visitorId: visitor(2), path: '/shop', referrer: 'http://localhost:3100/' });
    const { rows } = await pool.query(
      'SELECT kind, path, product_slug, referrer_host FROM analytics_events ORDER BY id',
    );
    expect(rows).toEqual([
      { kind: 'PAGE_VIEW', path: '/', product_slug: null, referrer_host: null },
      {
        kind: 'PRODUCT_VIEW',
        path: '/san-pham/non-la',
        product_slug: 'non-la',
        referrer_host: 'google.com',
      },
      { kind: 'PAGE_VIEW', path: '/shop', product_slug: null, referrer_host: null },
    ]);
  });

  it('rejects malformed beacons and rate-limits one visitor', async () => {
    expect((await track({ visitorId: 'short', path: '/' })).status).toBe(400);
    expect((await track({ visitorId: visitor(3), path: '//evil.com' })).status).toBe(400);
    for (let i = 0; i < 60; i += 1) await track({ visitorId: visitor(4), path: '/' });
    await track({ visitorId: visitor(4), path: '/' });
    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM analytics_events WHERE visitor_id = $1',
      [visitor(4)],
    );
    expect(rows[0].n).toBe(60);
  });
});

describe('admin analytics and accounts', () => {
  it('reports traffic and engagement and is ADMIN-only', async () => {
    await createUser(pool, 'CUSTOMER');
    await track({ visitorId: visitor(5), path: '/' });
    await track({ visitorId: visitor(5), path: '/san-pham/abc' });
    await track({ visitorId: visitor(6), path: '/' });
    const admin = await staff('ADMIN');
    const res = await admin.get('/v1/admin/analytics?days=7');
    expect(res.status).toBe(200);
    const d = adminAnalyticsSchema.parse(res.body);
    expect(d.daily).toHaveLength(7);
    expect(d.traffic).toMatchObject({
      pageViews: 3,
      visitors: 2,
      productViews: 1,
      visitorsToday: 2,
    });
    expect(d.topPages[0]).toMatchObject({ path: '/', views: 2 });
    expect(d.engagement.newAccounts).toBe(1);
    expect((await admin.get('/v1/admin/analytics?days=5')).status).toBe(400);
    expect((await (await staff('SUPPORT')).get('/v1/admin/analytics')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/v1/admin/analytics')).status).toBe(401);
  });

  it('lists accounts with filters, totals and no secrets', async () => {
    const customer = await createUser(pool, 'CUSTOMER');
    const admin = await staff('ADMIN');
    const res = await admin.get('/v1/admin/users');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/password|hash/i);
    const all = adminUserListSchema.parse(res.body);
    expect(all.summary.customers).toBe(1);
    expect(all.summary.staff).toBe(1);
    expect(all.items.map((u) => u.email)).toContain(customer.email);

    const only = adminUserListSchema.parse((await admin.get('/v1/admin/users?role=CUSTOMER')).body);
    expect(only.items).toHaveLength(1);
    const found = adminUserListSchema.parse(
      (await admin.get(`/v1/admin/users?q=${encodeURIComponent(customer.email.slice(0, 6))}`)).body,
    );
    expect(found.items.some((u) => u.email === customer.email)).toBe(true);
    expect((await (await staff('SUPPORT')).get('/v1/admin/users')).status).toBe(403);
  });
});
