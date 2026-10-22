import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminDashboardSchema } from '@nona/contracts';
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

const staff = async (role: 'ADMIN' | 'SUPPORT' | 'CATALOG') =>
  as(app, await login(app, (await createUser(pool, role)).email));

describe('admin dashboard', () => {
  it('is zero-filled on an empty shop and matches the shared contract', async () => {
    const res = await (await staff('ADMIN')).get('/v1/admin/dashboard');
    expect(res.status).toBe(200);
    const d = adminDashboardSchema.parse(res.body);
    expect(d.daily).toHaveLength(30);
    expect(d.weekly).toHaveLength(12);
    expect(d.monthly).toHaveLength(12);
    expect(d.kpis.revenueMonthVnd).toBe(0);
  });

  it('counts only revenue-bearing orders and needs orders:read', async () => {
    const admin = await staff('ADMIN');
    const insert = (status: string, total: number) =>
      pool.query(
        `INSERT INTO orders (public_code, customer_email, status, payment_method, subtotal_vnd, shipping_fee_vnd, total_vnd, shipping_address)
         VALUES (upper(substr(translate(md5(random()::text), 'ailou', 'bcdfg'), 1, 12)), 'a@b.vn', $1, 'COD', $2, 0, $2, '{}'::jsonb)`,
        [status, total],
      );
    await insert('COMPLETED', 500_000);
    await insert('CANCELLED', 900_000);
    await insert('PAID', 100_000);
    const d = adminDashboardSchema.parse((await admin.get('/v1/admin/dashboard')).body);
    expect(d.kpis.revenueTodayVnd).toBe(600_000);
    expect(d.kpis.ordersMonth).toBe(2);
    expect(d.kpis.averageOrderVnd).toBe(300_000);
    expect(d.kpis.awaitingAction).toBe(1);
    expect(d.statusBreakdown.find((s) => s.status === 'CANCELLED')?.count).toBe(1);

    expect((await request(app.getHttpServer()).get('/v1/admin/dashboard')).status).toBe(401);
    expect((await (await staff('CATALOG')).get('/v1/admin/dashboard')).status).toBe(403);
  });
});
