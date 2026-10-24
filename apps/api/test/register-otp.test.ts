import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { challengeSentSchema, meSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import {
  as,
  bootApp,
  cookieFrom,
  login,
  PASSWORD,
  register,
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
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE auth_challenges, outbox_events');
});

const post = (url: string, body: object) =>
  request(app.getHttpServer()).post(url).set('Origin', WEB_ORIGIN).send(body);
const start = (identifier: string, over: object = {}) =>
  post('/v1/auth/register/start', {
    fullName: 'Nguyễn Văn A',
    identifier,
    password: PASSWORD,
    confirmPassword: PASSWORD,
    ...over,
  });
const events = async (type: string) =>
  (
    await pool.query('SELECT payload FROM outbox_events WHERE type = $1 ORDER BY created_at', [
      type,
    ])
  ).rows;
const users = async () =>
  (await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n as number;

describe('sign-up by email or phone with a one-time code', () => {
  it('tells an email from a phone number by itself and sends the code to the right channel', async () => {
    const e = challengeSentSchema.parse((await start('Khach@Example.com')).body);
    expect(e).toMatchObject({ channel: 'EMAIL', destination: 'k***@example.com' });
    expect((await events('auth.email_otp'))[0]!.payload).toMatchObject({
      email: 'khach@example.com',
      code: e.devCode,
    });
    expect(await events('phone.otp')).toHaveLength(0);

    for (const typed of ['0912 345 678', '+84912345678', '84912345678', '0912.345.678']) {
      await pool.query('TRUNCATE auth_challenges, outbox_events');
      const p = challengeSentSchema.parse((await start(typed)).body);
      expect(p).toMatchObject({ channel: 'PHONE', destination: '+84 *** *** 678' });
      expect((await events('phone.otp'))[0]!.payload).toMatchObject({
        phone: '+84912345678',
        code: p.devCode,
      });
    }
  });

  it('refuses malformed emails and phone numbers with a clear message, and sends nothing', async () => {
    for (const bad of [
      '',
      'abc',
      'a@b',
      'no spaces@x.com',
      '0212345678',
      '0112345678',
      '091234567',
      '09123456789',
      '+8412345',
      '+1 415 555 0100',
    ]) {
      const res = await start(bad);
      expect(res.status, bad).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    }
    const wrongPrefix = await start('0212345678');
    expect(JSON.stringify(wrongPrefix.body)).toMatch(/đầu số/);
    expect(await events('phone.otp')).toHaveLength(0);
    expect(await events('auth.email_otp')).toHaveLength(0);
  });

  it('creates no account until the code is right; a wrong code is counted and locks after 5', async () => {
    const sent = (await start('0912345678')).body;
    expect(await users()).toBe(0);
    const bad = sent.devCode === '000000' ? '111111' : '000000';
    const wrong = await post('/v1/auth/register/verify', { token: sent.token, code: bad });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details.attemptsLeft).toBe(4);
    expect(await users()).toBe(0);
    for (let i = 0; i < 4; i++)
      await post('/v1/auth/register/verify', { token: sent.token, code: bad });
    expect(
      (await post('/v1/auth/register/verify', { token: sent.token, code: sent.devCode })).status,
    ).toBe(400);
    expect(await users()).toBe(0);
    expect(
      (await post('/v1/auth/register/verify', { token: randomUUID(), code: '123456' })).status,
    ).toBe(400);
  });

  it('a phone sign-up creates an account with a confirmed phone and no email, and signs in', async () => {
    const { res, session } = await register(app, '0912345678', PASSWORD, 'Lan');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const me = meSchema.parse(res.body);
    expect(me).toMatchObject({ email: null, fullName: 'Lan', role: 'CUSTOMER' });
    const u = (
      await pool.query(
        "SELECT phone, phone_verified_at, email FROM users WHERE phone = '+84912345678'",
      )
    ).rows[0];
    expect(u.phone_verified_at).toBeTruthy();
    expect(u.email).toBeNull();
    expect((await as(app, session!).get('/v1/me/phone')).body).toEqual({
      phone: '+84 *** *** 678',
      verified: true,
    });
    expect(await events('auth.welcome')).toHaveLength(0); // no email to greet
  });

  it('rejects an email or phone that already has an account', async () => {
    await register(app, 'dup@example.com');
    await register(app, '0912345678');
    const e = await start('DUP@example.com');
    expect(e.status).toBe(409);
    const p = await start('+84 912 345 678');
    expect(p.status).toBe(409);
    expect(p.body.error.message).toMatch(/Số điện thoại/);
  });

  it('can resend the code once the wait is over (the old code stops working)', async () => {
    const first = (await start('new@example.com')).body;
    const tooSoon = await post('/v1/auth/register/resend', { token: first.token });
    expect(tooSoon.status).toBe(429);
    await pool.query("UPDATE auth_challenges SET created_at = created_at - interval '2 minutes'");
    const second = await post('/v1/auth/register/resend', { token: first.token });
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.token).not.toBe(first.token);
    expect(
      (await post('/v1/auth/register/verify', { token: first.token, code: first.devCode })).status,
    ).toBe(400);
    expect(
      (
        await post('/v1/auth/register/verify', {
          token: second.body.token,
          code: second.body.devCode,
        })
      ).status,
    ).toBe(201);
  });

  it('expires the code after its lifetime', async () => {
    const sent = (await start('new@example.com')).body;
    await pool.query("UPDATE auth_challenges SET expires_at = now() - interval '1 second'");
    expect(
      (await post('/v1/auth/register/verify', { token: sent.token, code: sent.devCode })).status,
    ).toBe(400);
    expect(await users()).toBe(0);
  });

  it('the old one-step endpoint is gone', async () => {
    expect(
      (
        await post('/v1/auth/register', {
          email: 'x@example.com',
          password: PASSWORD,
          fullName: 'X',
        })
      ).status,
    ).toBe(404);
  });
});

describe('signing in and resetting the password with a phone number', () => {
  it('signs in with the phone number in any common format, and with the email as before', async () => {
    await register(app, '0912345678');
    for (const typed of ['0912345678', '+84912345678', '0912 345 678']) {
      const res = await post('/v1/auth/login', { email: typed, password: PASSWORD });
      expect(res.status, typed).toBe(200);
      expect(cookieFrom(res, 'nona_session')).toBeTruthy();
    }
    expect(
      (await post('/v1/auth/login', { email: '0912345678', password: 'wrong-password-1' })).status,
    ).toBe(401);
    await register(app, 'mail@example.com');
    expect(
      (await post('/v1/auth/login', { email: 'mail@example.com', password: PASSWORD })).status,
    ).toBe(200);
  });

  it('resets a forgotten password by SMS code, signs out every session, and never reveals unknown numbers', async () => {
    await register(app, '0912345678');
    const old = await login(app, '0912345678');
    const known = await post('/v1/auth/forgot-password', { identifier: '0912345678' });
    expect(known.status).toBe(202);
    const unknown = await post('/v1/auth/forgot-password', { identifier: '0987654321' });
    expect(unknown.status).toBe(202);
    expect(Object.keys(unknown.body).sort()).toEqual(Object.keys(known.body).sort()); // same shape either way
    expect(await events('phone.otp')).toHaveLength(2); // the sign-up code and one reset code: none for the unknown number

    const bad = await post('/v1/auth/reset-password/phone', {
      token: known.body.token,
      code: known.body.devCode === '000000' ? '111111' : '000000',
      newPassword: 'a-brand-new-password',
      confirmPassword: 'a-brand-new-password',
    });
    expect(bad.status).toBe(400);
    const mismatch = await post('/v1/auth/reset-password/phone', {
      token: known.body.token,
      code: known.body.devCode,
      newPassword: 'a-brand-new-password',
      confirmPassword: 'different-password-1',
    });
    expect(mismatch.status).toBe(400);
    const ok = await post('/v1/auth/reset-password/phone', {
      token: known.body.token,
      code: known.body.devCode,
      newPassword: 'a-brand-new-password',
      confirmPassword: 'a-brand-new-password',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(204);
    expect((await as(app, old).get('/v1/me')).status).toBe(401);
    expect(
      (await post('/v1/auth/login', { email: '0912345678', password: 'a-brand-new-password' }))
        .status,
    ).toBe(200);
    // the code for the unknown number can never reset anything
    const fake = await post('/v1/auth/reset-password/phone', {
      token: unknown.body.token,
      code: unknown.body.devCode,
      newPassword: 'a-brand-new-password',
      confirmPassword: 'a-brand-new-password',
    });
    expect(fake.status).toBe(400);
  });

  it('still resets by email link for email accounts, and rejects a malformed identifier', async () => {
    await register(app, 'mail@example.com');
    expect((await post('/v1/auth/forgot-password', { email: 'mail@example.com' })).status).toBe(
      202,
    );
    expect(await events('auth.password_reset')).toHaveLength(1);
    expect((await post('/v1/auth/forgot-password', { identifier: '0212345678' })).status).toBe(400);
  });
});

describe('ordering with a phone account', () => {
  it('needs no email, and its confirmed phone already counts as verified for delivery', async () => {
    await pool.query(
      `UPDATE site_settings SET value = '{"paymentWindowMinutes": 30, "requirePhoneVerification": true}' WHERE key = 'checkout'`,
    );
    const { session } = await register(app, '0912345678');
    const api = as(app, session!);
    const r = await createProduct(pool, {
      categoryId: await createCategory(pool),
      variants: [{ price: 100_000, stock: 5 }],
    });
    await api.post('/v1/cart/items').send({ variantId: r.variantIds[0], quantity: 1 });
    const body = {
      shippingAddress: {
        fullName: 'Lan',
        phone: '0912345678',
        line1: '1 Lê Lợi',
        ward: 'Bến Thành',
        district: 'Quận 1',
        province: 'TP. Hồ Chí Minh',
      },
      paymentMethod: 'COD',
      expectedTotalVnd: 130_000,
    };
    const placed = await api.post('/v1/orders').set('Idempotency-Key', randomUUID()).send(body);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.customerEmail).toBeNull();
    // a different, unverified number still needs its own code
    await api.post('/v1/cart/items').send({ variantId: r.variantIds[0], quantity: 1 });
    const other = await api
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ ...body, shippingAddress: { ...body.shippingAddress, phone: '0987654321' } });
    expect(other.body.error.code).toBe('PHONE_NOT_VERIFIED');
  });
});
