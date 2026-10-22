import type { NestExpressApplication } from '@nestjs/platform-express';
import { storefrontSettingsSchema } from '@nona/contracts';
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
beforeEach(() => resetAll(pool));

const publicSettings = async () =>
  storefrontSettingsSchema.parse(
    (await request(app.getHttpServer()).get('/v1/storefront/settings')).body,
  );

describe('admin-managed settings', () => {
  it('serves the announcement and free-shipping threshold publicly from the database', async () => {
    const s = await publicSettings();
    expect(s.announcement.text).toContain('600.000đ');
    expect(s.freeShippingThresholdVnd).toBe(600_000);
  });

  it('lets an admin change them, versions the change, and audits before/after', async () => {
    const admin = await login(app, (await createUser(pool, 'ADMIN')).email);
    const api = as(app, admin);
    const before = (await api.get('/v1/admin/settings')).body;
    const res = await api.patch('/v1/admin/settings/announcement').send({
      version: before.announcement.version,
      value: { enabled: true, text: 'Giảm 10% cuối tuần', linkUrl: '/shop' },
    });
    expect(res.status).toBe(200);
    expect(res.body.announcement.version).toBe(before.announcement.version + 1);
    await api.patch('/v1/admin/settings/shipping').send({
      version: before.shipping.version,
      value: { freeShippingThresholdVnd: 450_000, flatFeeVnd: 30_000 },
    });
    const s = await publicSettings();
    expect(s.announcement).toEqual({ enabled: true, text: 'Giảm 10% cuối tuần', linkUrl: '/shop' });
    expect(s.freeShippingThresholdVnd).toBe(450_000);
    const audit = await pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'settings.update' AND target_id = 'announcement'`,
    );
    expect(audit.rows[0].metadata.before.text).toContain('600.000đ');
    expect(audit.rows[0].metadata.after.text).toBe('Giảm 10% cuối tuần');
  });

  it('can switch the offer off entirely', async () => {
    const admin = await login(app, (await createUser(pool, 'ADMIN')).email);
    const api = as(app, admin);
    const v = (await api.get('/v1/admin/settings')).body;
    await api.patch('/v1/admin/settings/announcement').send({
      version: v.announcement.version,
      value: { enabled: false, text: 'ẩn', linkUrl: null },
    });
    await api.patch('/v1/admin/settings/shipping').send({
      version: v.shipping.version,
      value: { freeShippingThresholdVnd: null, flatFeeVnd: 30_000 },
    });
    const s = await publicSettings();
    expect(s.announcement.enabled).toBe(false);
    expect(s.freeShippingThresholdVnd).toBeNull();
  });

  it('rejects stale versions, unknown keys, unknown fields and unsafe links', async () => {
    const admin = await login(app, (await createUser(pool, 'ADMIN')).email);
    const api = as(app, admin);
    const patch = (key: string, body: object) => api.patch(`/v1/admin/settings/${key}`).send(body);
    const ok = { enabled: true, text: 'x', linkUrl: null };
    expect((await patch('announcement', { version: 99, value: ok })).status).toBe(409);
    expect((await patch('nonexistent', { version: 1, value: ok })).status).toBe(404);
    expect((await patch('announcement', { version: 1, value: { ...ok, extra: 1 } })).status).toBe(
      400,
    );
    expect(
      (
        await patch('announcement', {
          version: 1,
          value: { ...ok, linkUrl: 'javascript:alert(1)' },
        })
      ).status,
    ).toBe(400);
    expect(
      (await patch('announcement', { version: 1, value: { ...ok, linkUrl: '//evil.example' } }))
        .status,
    ).toBe(400);
    expect(
      (
        await patch('shipping', {
          version: 1,
          value: { freeShippingThresholdVnd: -5, flatFeeVnd: 30_000 },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await patch('shipping', {
          version: 1,
          value: { freeShippingThresholdVnd: 1.5, flatFeeVnd: 30_000 },
        })
      ).status,
    ).toBe(400);
    expect((await publicSettings()).freeShippingThresholdVnd).toBe(600_000);
  });

  it('only admins may change them', async () => {
    const catalog = await login(app, (await createUser(pool, 'CATALOG')).email);
    const res = await as(app, catalog)
      .patch('/v1/admin/settings/shipping')
      .send({ version: 1, value: { freeShippingThresholdVnd: 1, flatFeeVnd: 30_000 } });
    expect(res.status).toBe(403);
    expect((await publicSettings()).freeShippingThresholdVnd).toBe(600_000);
  });
});
