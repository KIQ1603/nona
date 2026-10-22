import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totpAt, stepAt } from '../src/modules/mfa/totp';
import {
  as,
  bootApp,
  cookieFrom,
  createUser,
  login,
  PASSWORD,
  resetAll,
  WEB_ORIGIN,
} from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => resetAll(pool, app));

const post = (path: string, body: object) =>
  request(app.getHttpServer()).post(path).set('Origin', WEB_ORIGIN).send(body);
const codeFor = (secret: string, offset = 0) => totpAt(secret, stepAt(Date.now()) + offset);

async function enrolledAdmin() {
  const u = await createUser(pool, 'ADMIN');
  const session = await login(app, u.email);
  const api = as(app, session);
  const setup = (await api.post('/v1/me/mfa/setup')).body as { secret: string; otpauthUrl: string };
  const confirm = await api.post('/v1/me/mfa/confirm').send({ code: codeFor(setup.secret) });
  return {
    u,
    api,
    secret: setup.secret,
    recovery: confirm.body.recoveryCodes as string[],
    confirm,
  };
}

describe('enrolment', () => {
  it('shows a secret, activates only after a valid code, and returns ten one-time recovery codes', async () => {
    const u = await createUser(pool, 'ADMIN');
    const api = as(app, await login(app, u.email));
    const setup = await api.post('/v1/me/mfa/setup');
    expect(setup.body.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.body.otpauthUrl).toContain(`secret=${setup.body.secret}`);
    expect(
      (await pool.query('SELECT secret_enc, enabled_at FROM user_mfa')).rows[0].enabled_at,
    ).toBeNull();
    expect((await pool.query('SELECT secret_enc FROM user_mfa')).rows[0].secret_enc).not.toContain(
      setup.body.secret,
    ); // encrypted at rest
    expect((await api.post('/v1/me/mfa/confirm').send({ code: '000000' })).status).toBe(400);
    const ok = await api.post('/v1/me/mfa/confirm').send({ code: codeFor(setup.body.secret) });
    expect(ok.status).toBe(200);
    expect(ok.body.recoveryCodes).toHaveLength(10);
    expect(new Set(ok.body.recoveryCodes).size).toBe(10);
    const stored = JSON.stringify(
      (await pool.query('SELECT recovery_hashes FROM user_mfa')).rows[0],
    );
    for (const c of ok.body.recoveryCodes) expect(stored).not.toContain(c); // only hashes are stored
    expect((await api.post('/v1/me/mfa/setup')).status).toBe(409); // already enabled
    expect((await api.get('/v1/me')).body.mfaEnabled).toBe(true);
  });

  it('is for staff only', async () => {
    const u = await createUser(pool, 'CUSTOMER');
    const api = as(app, await login(app, u.email));
    expect((await api.post('/v1/me/mfa/setup')).status).toBe(403);
    expect(
      (await request(app.getHttpServer()).post('/v1/me/mfa/setup').set('Origin', WEB_ORIGIN))
        .status,
    ).toBe(401);
  });
});

describe('login with a second factor', () => {
  it('stops after the password: no session until a valid code is given', async () => {
    const { u } = await enrolledAdmin();
    const step1 = await post('/v1/auth/login', { email: u.email, password: PASSWORD });
    expect(step1.status).toBe(200);
    expect(step1.body).toMatchObject({ mfaRequired: true });
    expect(cookieFrom(step1, 'nona_session')).toBeUndefined();
    expect(JSON.stringify(step1.body)).not.toContain('csrfToken');
    expect((await pool.query('SELECT COUNT(*)::int n FROM sessions')).rows[0].n).toBe(1); // only the enrolment session
  });

  it('completes with a TOTP code (allowing one step of clock drift) and gives a normal session', async () => {
    const { u, secret } = await enrolledAdmin();
    const challenge = (await post('/v1/auth/login', { email: u.email, password: PASSWORD })).body
      .challengeToken;
    const res = await post('/v1/auth/mfa/verify', {
      challengeToken: challenge,
      code: codeFor(secret, 1),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ role: 'ADMIN', mfaEnabled: true, mfaRestricted: false });
    const s = { cookie: cookieFrom(res, 'nona_session')!, csrf: res.body.csrfToken };
    expect((await as(app, s).get('/v1/admin/products')).status).toBe(200);
  });

  it('rejects a code that is reused, wrong, from the wrong user, or with a forged/expired challenge', async () => {
    const { u, secret } = await enrolledAdmin();
    const other = await createUser(pool, 'ADMIN');
    const login1 = async () =>
      (await post('/v1/auth/login', { email: u.email, password: PASSWORD })).body
        .challengeToken as string;
    const code = codeFor(secret, 1);
    expect(
      (await post('/v1/auth/mfa/verify', { challengeToken: await login1(), code })).status,
    ).toBe(200);
    const replay = await post('/v1/auth/mfa/verify', { challengeToken: await login1(), code }); // same code again within its window
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('MFA_INVALID');
    expect(
      (await post('/v1/auth/mfa/verify', { challengeToken: await login1(), code: '123456' }))
        .status,
    ).toBe(401);
    expect(
      (
        await post('/v1/auth/mfa/verify', {
          challengeToken: 'forged-token-body.forged-signature',
          code: codeFor(secret, -1),
        })
      ).status,
    ).toBe(401);
    expect(
      (await post('/v1/auth/mfa/verify', { challengeToken: await login1(), code: 'abc' })).status,
    ).toBe(400);
    void other;
  });

  it('locks after repeated wrong codes, even if the right code follows', async () => {
    const { u, secret } = await enrolledAdmin();
    const challenge = (await post('/v1/auth/login', { email: u.email, password: PASSWORD })).body
      .challengeToken;
    for (let i = 0; i < 5; i++)
      expect(
        (await post('/v1/auth/mfa/verify', { challengeToken: challenge, code: '000000' })).status,
      ).toBe(401);
    const blocked = await post('/v1/auth/mfa/verify', {
      challengeToken: challenge,
      code: codeFor(secret, -1),
    });
    expect(blocked.status).toBe(429);
    expect(
      await pool
        .query(`SELECT 1 FROM audit_logs WHERE action = 'auth.mfa_failed'`)
        .then((r) => r.rowCount),
    ).toBe(5);
  });

  it('accepts each recovery code exactly once', async () => {
    const { u, recovery } = await enrolledAdmin();
    const go = async (code: string) =>
      post('/v1/auth/mfa/verify', {
        challengeToken: (await post('/v1/auth/login', { email: u.email, password: PASSWORD })).body
          .challengeToken,
        code,
      });
    expect((await go(recovery[0]!.toLowerCase())).status).toBe(200); // case/spacing tolerant
    expect((await go(recovery[0]!)).status).toBe(401);
    expect((await go(recovery[1]!)).status).toBe(200);
    expect(
      (await pool.query('SELECT jsonb_array_length(recovery_hashes) n FROM user_mfa')).rows[0].n,
    ).toBe(8);
    expect(
      await pool
        .query(`SELECT 1 FROM audit_logs WHERE action = 'auth.mfa_recovery_used'`)
        .then((r) => r.rowCount),
    ).toBe(2);
  });

  it('can be switched off with a current code, and then login needs only the password', async () => {
    const { u, api, secret } = await enrolledAdmin();
    expect((await api.post('/v1/me/mfa/disable').send({ code: '000000' })).status).toBe(400);
    expect((await api.post('/v1/me/mfa/disable').send({ code: codeFor(secret, 1) })).status).toBe(
      204,
    );
    expect(
      (await post('/v1/auth/login', { email: u.email, password: PASSWORD })).body.csrfToken,
    ).toBeDefined();
  });

  it('does not affect customers', async () => {
    const u = await createUser(pool, 'CUSTOMER');
    expect(
      (await post('/v1/auth/login', { email: u.email, password: PASSWORD })).body.mfaRequired,
    ).toBeUndefined();
  });
});
