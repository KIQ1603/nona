import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env';
import { stepAt, totpAt } from '../src/modules/mfa/totp';
import { as, bootApp, createUser, login, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp({ requireStaffMfa: true })));
afterAll(async () => {
  await app.close();
  await pool.end();
  process.env.REQUIRE_STAFF_MFA = 'false';
});
beforeEach(() => resetAll(pool, app));

describe('REQUIRE_STAFF_MFA=true (production policy)', () => {
  it('lets staff in only far enough to enrol, then unlocks the admin area', async () => {
    const u = await createUser(pool, 'ADMIN');
    const session = await login(app, u.email);
    const api = as(app, session);
    const me = (await api.get('/v1/me')).body;
    expect(me).toMatchObject({ mfaEnabled: false, mfaRestricted: true });
    const blocked = await api.get('/v1/admin/products');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MFA_REQUIRED');
    expect((await api.get('/v1/admin/audit-logs')).body.error.code).toBe('MFA_REQUIRED');
    expect((await api.post('/v1/admin/categories').send({ name: 'x' })).body.error.code).toBe(
      'MFA_REQUIRED',
    );
    expect(await pool.query('SELECT 1 FROM categories').then((r) => r.rowCount)).toBe(0);

    const setup = (await api.post('/v1/me/mfa/setup')).body;
    expect(
      (
        await api
          .post('/v1/me/mfa/confirm')
          .send({ code: totpAt(setup.secret, stepAt(Date.now())) })
      ).status,
    ).toBe(200);
    expect((await api.get('/v1/admin/products')).status).toBe(200);
    expect((await api.get('/v1/me')).body.mfaRestricted).toBe(false);
  });

  it('does not allow turning the second factor off', async () => {
    const u = await createUser(pool, 'ADMIN');
    const api = as(app, await login(app, u.email));
    const setup = (await api.post('/v1/me/mfa/setup')).body;
    await api.post('/v1/me/mfa/confirm').send({ code: totpAt(setup.secret, stepAt(Date.now())) });
    const off = await api
      .post('/v1/me/mfa/disable')
      .send({ code: totpAt(setup.secret, stepAt(Date.now()) + 1) });
    expect(off.status).toBe(403);
    expect(
      await pool
        .query('SELECT 1 FROM user_mfa WHERE enabled_at IS NOT NULL')
        .then((r) => r.rowCount),
    ).toBe(1);
  });

  it('never restricts customers', async () => {
    const u = await createUser(pool, 'CUSTOMER');
    const api = as(app, await login(app, u.email));
    expect((await api.get('/v1/me')).body.mfaRestricted).toBe(false);
    expect((await api.get('/v1/wishlist')).status).toBe(200);
    void request;
  });
});

describe('environment validation', () => {
  const base = { DATABASE_URL: 'postgres://x:y@localhost:5432/db' };
  it('forbids the payment simulator in production and requires real credentials, token and MFA key', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' } as never)).toThrow(
      /PAYMENTS_MODE|required in production/,
    );
    const prod = {
      ...base,
      NODE_ENV: 'production',
      PAYMENTS_MODE: 'vnpay',
      VNPAY_TMN_CODE: 'T',
      VNPAY_HASH_SECRET: 'x'.repeat(32),
      VNPAY_PAY_URL: 'https://pay.vn/x',
      VNPAY_API_URL: 'https://api.vn/x',
      SMS_MODE: 'zalo',
      OTP_SECRET: 'o'.repeat(32),
    };
    expect(() => loadEnv(prod as never)).toThrow(/INTERNAL_API_TOKEN|MFA_ENCRYPTION_KEY/);
    expect(() => loadEnv({ ...prod, SMS_MODE: 'simulator' } as never)).toThrow(/SMS simulator/);
    expect(() => loadEnv({ ...prod, OTP_SECRET: undefined } as never)).toThrow(/OTP_SECRET/);
    expect(() =>
      loadEnv({
        ...prod,
        INTERNAL_API_TOKEN: 'i'.repeat(32),
        MFA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
      } as never),
    ).not.toThrow();
    expect(() =>
      loadEnv({
        ...prod,
        INTERNAL_API_TOKEN: 'i'.repeat(32),
        MFA_ENCRYPTION_KEY: 'short',
      } as never),
    ).toThrow(/32 bytes/);
  });
  it('defaults to a safe local simulator in development', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' } as never);
    expect(env.PAYMENTS_MODE).toBe('simulator');
    expect(env.VNPAY_PAY_URL).toMatch(/\/dev\/vnpay$/);
    expect(env.REQUIRE_STAFF_MFA).toBe(false);
  });
  it('requires vnpay credentials whenever PAYMENTS_MODE=vnpay', () => {
    expect(() =>
      loadEnv({ ...base, NODE_ENV: 'development', PAYMENTS_MODE: 'vnpay' } as never),
    ).toThrow(/VNPAY_TMN_CODE/);
  });
});
