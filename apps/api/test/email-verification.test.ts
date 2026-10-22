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
  it('sends a welcome email with a verification code on sign-up', async () => {
    const { session } = await register(app, 'new@example.com');
    expect(session).toBeTruthy();
    const [w] = await events('auth.welcome');
    expect(w.payload).toMatchObject({ email: 'new@example.com', ttlMinutes: 10 });
    expect(w.payload.code).toMatch(/^\d{6}$/);
    const api = as(app, session!);
    expect((await api.get('/v1/me/email')).body).toEqual({
      email: 'new@example.com',
      verified: false,
    });
    const wrong = await api
      .post('/v1/me/email/verify')
      .send({ code: w.payload.code === '000000' ? '111111' : '000000' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.attemptsLeft).toBe(4);
    const ok = await api.post('/v1/me/email/verify').send({ code: w.payload.code });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ email: 'new@example.com', verified: true });
    expect((await api.post('/v1/me/email/otp').send({})).status).toBe(409); // already verified
  });

  it('can send a new code (rate-limited), and only the newest works', async () => {
    const { session } = await register(app, 'again@example.com');
    const api = as(app, session!);
    const first = (await events('auth.welcome'))[0].payload.code as string;
    expect((await api.post('/v1/me/email/otp').send({})).status).toBe(429); // too soon after sign-up
    await pool.query("UPDATE email_otps SET created_at = created_at - interval '2 minutes'");
    const res = await api.post('/v1/me/email/otp').send({});
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const [mail] = await events('auth.email_otp');
    expect(mail.payload).toMatchObject({ email: 'again@example.com', code: res.body.devCode });
    if (first !== res.body.devCode)
      expect((await api.post('/v1/me/email/verify').send({ code: first })).status).toBe(400);
    expect((await api.post('/v1/me/email/verify').send({ code: res.body.devCode })).status).toBe(
      200,
    );
  });

  it('locks the code after five wrong tries and expires it', async () => {
    const { session } = await register(app, 'lock@example.com');
    const api = as(app, session!);
    const code = (await events('auth.welcome'))[0].payload.code as string;
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
