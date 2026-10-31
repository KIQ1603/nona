import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapAccounts } from '../../../database/src/users';
import { bootApp, resetAll, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => resetAll(pool, app));

const ENV = {
  BOOTSTRAP_ADMIN_EMAIL: 'Admin@Example.com',
  BOOTSTRAP_ADMIN_PASSWORD: 'a-long-admin-password',
  BOOTSTRAP_USER_EMAIL: 'khach@example.com',
  BOOTSTRAP_USER_PASSWORD: 'a-customer-password',
};
const login = (email: string, password: string) =>
  request(app.getHttpServer())
    .post('/v1/auth/login')
    .set('Origin', WEB_ORIGIN)
    .send({ email, password });

describe('first accounts after a deploy', () => {
  it('creates one admin and one customer who can sign in at once', async () => {
    expect(await bootstrapAccounts(pool, ENV)).toEqual([
      'ADMIN admin@example.com',
      'CUSTOMER khach@example.com',
    ]);
    const user = await login('khach@example.com', ENV.BOOTSTRAP_USER_PASSWORD);
    expect(user.status).toBe(200);
    expect(user.body.role).toBe('CUSTOMER');
    const rows = (
      await pool.query('SELECT email, role, email_verified_at FROM users ORDER BY role')
    ).rows;
    expect(rows.map((r) => [r.email, r.role, r.email_verified_at !== null])).toEqual([
      ['admin@example.com', 'ADMIN', true],
      ['khach@example.com', 'CUSTOMER', true],
    ]);
  });

  it('is safe to run on every start: an existing account is never changed', async () => {
    await bootstrapAccounts(pool, ENV);
    await pool.query("UPDATE users SET full_name = 'Đổi tên' WHERE email = 'admin@example.com'");
    expect(
      await bootstrapAccounts(pool, { ...ENV, BOOTSTRAP_ADMIN_PASSWORD: 'another-long-password' }),
    ).toEqual([]);
    // the password set the first time still works, the new one does not
    expect((await login('khach@example.com', ENV.BOOTSTRAP_USER_PASSWORD)).status).toBe(200);
    const name = (await pool.query("SELECT full_name FROM users WHERE email = 'admin@example.com'"))
      .rows[0].full_name;
    expect(name).toBe('Đổi tên');
  });

  it('creates nothing without both an email and a password, and refuses a weak password', async () => {
    expect(await bootstrapAccounts(pool, {})).toEqual([]);
    expect(await bootstrapAccounts(pool, { BOOTSTRAP_ADMIN_EMAIL: 'a@example.com' })).toEqual([]);
    await expect(
      bootstrapAccounts(pool, {
        BOOTSTRAP_ADMIN_EMAIL: 'a@example.com',
        BOOTSTRAP_ADMIN_PASSWORD: 'short',
      }),
    ).rejects.toThrow(/at least 12/);
    expect((await pool.query('SELECT 1 FROM users')).rowCount).toBe(0);
  });

  it('accepts short demo passwords only when explicitly allowed', async () => {
    const demo = {
      BOOTSTRAP_ADMIN_EMAIL: 'admin@sacham',
      BOOTSTRAP_ADMIN_PASSWORD: '111',
      BOOTSTRAP_USER_EMAIL: 'user@saccham',
      BOOTSTRAP_USER_PASSWORD: '1',
    };
    await expect(bootstrapAccounts(pool, demo)).rejects.toThrow(/at least/);
    expect(
      await bootstrapAccounts(pool, { ...demo, BOOTSTRAP_ALLOW_WEAK_PASSWORDS: 'true' }),
    ).toEqual(['ADMIN admin@sacham', 'CUSTOMER user@saccham']);
    expect((await login('admin@sacham', '111')).status).toBe(200);
    expect((await login('user@saccham', '1')).status).toBe(200);
  });
});
