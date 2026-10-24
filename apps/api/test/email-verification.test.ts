import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, bootApp, PASSWORD, register, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE email_otps, outbox_events');
});

const events = async (type: string) =>
  (
    await pool.query('SELECT payload FROM outbox_events WHERE type = $1 ORDER BY created_at', [
      type,
    ])
  ).rows;

describe('account emails', () => {
  it('mails the sign-up code first, and only a correct code creates an already-confirmed account plus a welcome email', async () => {
    const start = await register(app, 'new@example.com');
    expect(start.res.status).toBe(201);
    const [otp] = await events('auth.email_otp');
    expect(otp.payload).toMatchObject({
      email: 'new@example.com',
      code: start.start!.body.devCode,
    });
    const [w] = await events('auth.welcome');
    expect(w.payload).toMatchObject({ email: 'new@example.com' });
    expect(w.payload.code).toBeUndefined(); // already proven: no second code
    const api = as(app, start.session!);
    expect((await api.get('/v1/me/email')).body).toEqual({
      email: 'new@example.com',
      verified: true,
    });
  });

  it('lets an older, unconfirmed account request and confirm a code (rate-limited, newest code only)', async () => {
    const { session } = await register(app, 'old@example.com');
    await pool.query("UPDATE users SET email_verified_at = NULL WHERE email = 'old@example.com'");
    const api = as(app, session!);
    expect((await api.get('/v1/me/email')).body.verified).toBe(false);
    const first = await api.post('/v1/me/email/otp').send({});
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect((await api.post('/v1/me/email/otp').send({})).status).toBe(429);
    const bad = first.body.devCode === '000000' ? '111111' : '000000';
    const wrong = await api.post('/v1/me/email/verify').send({ code: bad });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.attemptsLeft).toBe(4);
    const ok = await api.post('/v1/me/email/verify').send({ code: first.body.devCode });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ email: 'old@example.com', verified: true });
  });

  it('locks the code after five wrong tries and expires it', async () => {
    const { session } = await register(app, 'lock@example.com');
    await pool.query("UPDATE users SET email_verified_at = NULL WHERE email = 'lock@example.com'");
    const api = as(app, session!);
    const res = await api.post('/v1/me/email/otp').send({});
    const code = res.body.devCode as string;
    const bad = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) await api.post('/v1/me/email/verify').send({ code: bad });
    expect((await api.post('/v1/me/email/verify').send({ code })).status).toBe(400);
    await pool.query(
      "UPDATE email_otps SET consumed_at = NULL, attempts = 0, expires_at = now() - interval '1 second'",
    );
    expect((await api.post('/v1/me/email/verify').send({ code })).status).toBe(400);
  });

  it('mails a notice when the password is changed', async () => {
    const { session } = await register(app, 'pw@example.com');
    const res = await as(app, session!).post('/v1/me/password').send({
      currentPassword: PASSWORD,
      newPassword: 'another-long-password',
      confirmPassword: 'another-long-password',
    });
    expect(res.status).toBe(204);
    const [n] = await events('auth.password_changed');
    expect(n.payload).toMatchObject({ email: 'pw@example.com', how: 'change' });
  });
});
