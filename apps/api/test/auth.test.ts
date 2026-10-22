import type { NestExpressApplication } from '@nestjs/platform-express';
import { apiErrorSchema, meSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, bootApp, createUser, login, PASSWORD, resetAll, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => resetAll(pool));

const post = (url: string, body: object, origin: string | null = WEB_ORIGIN) => {
  const r = request(app.getHttpServer()).post(url);
  if (origin) r.set('Origin', origin);
  return r.send(body);
};

describe('login', () => {
  it('sets an HttpOnly SameSite session cookie and returns the profile with permissions', async () => {
    const u = await createUser(pool, 'CATALOG');
    const res = await post('/v1/auth/login', { email: u.email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/nona_session=.+HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const me = meSchema.parse(res.body);
    expect(me.permissions).toContain('catalog:write');
    expect(me.permissions).not.toContain('settings:write');
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password/i);
    // only a hash of the token is stored
    const stored = await pool.query('SELECT token_hash FROM sessions');
    expect(cookie).not.toContain(stored.rows[0].token_hash);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const u = await createUser(pool, 'ADMIN');
    const wrong = await post('/v1/auth/login', { email: u.email, password: 'nope-nope-nope' });
    const unknown = await post('/v1/auth/login', {
      email: 'ghost@nona.test',
      password: 'nope-nope-nope',
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(apiErrorSchema.parse(wrong.body).error.message).toBe(
      apiErrorSchema.parse(unknown.body).error.message,
    );
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects disabled accounts', async () => {
    const u = await createUser(pool, 'ADMIN', { status: 'DISABLED' });
    expect((await post('/v1/auth/login', { email: u.email, password: PASSWORD })).status).toBe(401);
  });

  it('throttles repeated failures, then still blocks the correct password for the window', async () => {
    const u = await createUser(pool, 'ADMIN');
    for (let i = 0; i < 5; i++)
      expect(
        (await post('/v1/auth/login', { email: u.email, password: 'bad-bad-bad-bad' })).status,
      ).toBe(401);
    const blocked = await post('/v1/auth/login', { email: u.email, password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('audits successful and failed logins', async () => {
    const u = await createUser(pool, 'ADMIN');
    await post('/v1/auth/login', { email: u.email, password: 'bad-bad-bad-bad' });
    await login(app, u.email);
    const actions = (
      await pool.query('SELECT action FROM audit_logs ORDER BY created_at')
    ).rows.map((r) => r.action);
    expect(actions).toEqual(['auth.login_failed', 'auth.login']);
  });

  it('rejects a cross-origin login attempt', async () => {
    const u = await createUser(pool, 'ADMIN');
    const res = await post(
      '/v1/auth/login',
      { email: u.email, password: PASSWORD },
      'https://evil.example',
    );
    expect(res.status).toBe(403);
    expect(res.headers['set-cookie']).toBeUndefined();
  });
});

describe('session protection', () => {
  it('requires authentication for admin routes', async () => {
    for (const path of [
      '/v1/admin/products',
      '/v1/admin/categories',
      '/v1/admin/settings',
      '/v1/admin/audit-logs',
      '/v1/me',
    ]) {
      const res = await request(app.getHttpServer()).get(path);
      expect(res.status, path).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    }
  });

  it('requires a matching CSRF token and same-site Origin on writes', async () => {
    const u = await createUser(pool, 'ADMIN');
    const s = await login(app, u.email);
    const noCsrf = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Cookie', s.cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ name: 'X' });
    expect(noCsrf.status).toBe(403);
    expect(noCsrf.body.error.details.reason).toBe('csrf');
    const wrongCsrf = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Cookie', s.cookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', 'x'.repeat(s.csrf.length))
      .send({ name: 'X' });
    expect(wrongCsrf.status).toBe(403);
    const badOrigin = await request(app.getHttpServer())
      .post('/v1/admin/categories')
      .set('Cookie', s.cookie)
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', s.csrf)
      .send({ name: 'X' });
    expect(badOrigin.status).toBe(403);
    expect((await pool.query('SELECT 1 FROM categories')).rowCount).toBe(0);
    expect((await as(app, s).post('/v1/admin/categories').send({ name: 'X' })).status).toBe(201);
  });

  it('logout revokes the session server-side', async () => {
    const u = await createUser(pool, 'ADMIN');
    const s = await login(app, u.email);
    expect((await as(app, s).get('/v1/me')).status).toBe(200);
    expect((await as(app, s).post('/v1/auth/logout')).status).toBe(204);
    expect((await as(app, s).get('/v1/me')).status).toBe(401);
  });

  it('stops honouring sessions of accounts that get disabled, expired or idle', async () => {
    const u = await createUser(pool, 'ADMIN');
    const s = await login(app, u.email);
    await pool.query(`UPDATE users SET status = 'DISABLED' WHERE id = $1`, [u.id]);
    expect((await as(app, s).get('/v1/me')).status).toBe(401);
    await pool.query(`UPDATE users SET status = 'ACTIVE' WHERE id = $1`, [u.id]);
    expect((await as(app, s).get('/v1/me')).status).toBe(200);
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '13 hours'`);
    expect((await as(app, s).get('/v1/me')).status).toBe(401);
  });
});

describe('authorization', () => {
  it('denies operations the role does not grant and changes nothing', async () => {
    const fulfillment = await createUser(pool, 'FULFILLMENT');
    const s = await login(app, fulfillment.email);
    const res = await as(app, s).post('/v1/admin/categories').send({ name: 'Không được phép' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect((await pool.query('SELECT 1 FROM categories')).rowCount).toBe(0);
    expect(
      (
        await as(app, s)
          .patch('/v1/admin/settings/announcement')
          .send({ version: 1, value: { enabled: false, text: '', linkUrl: null } })
      ).status,
    ).toBe(403);
    expect((await as(app, s).get('/v1/admin/audit-logs')).status).toBe(403);
  });

  it('keeps customers out of the admin area entirely', async () => {
    const c = await createUser(pool, 'CUSTOMER');
    const s = await login(app, c.email);
    expect((await as(app, s).get('/v1/admin/products')).status).toBe(403);
  });
});
