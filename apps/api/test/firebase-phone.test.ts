import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createSign, generateKeyPairSync } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { authProvidersSchema, challengeSentSchema, quoteSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import { as, bootApp, createUser, guest, login, PASSWORD, resetAll, WEB_ORIGIN } from './helpers';

const PROJECT = 'nona-test-project';
const KID = 'test-key-1';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

/** A Firebase ID token like the SDK returns after the SMS code was typed, signed with the given key. */
function mint(over: Record<string, unknown> = {}, key = privateKey, kid = KID) {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'firebase-uid-1',
    iat: now,
    auth_time: now,
    exp: now + 3600,
    phone_number: '+84912345678',
    firebase: { sign_in_provider: 'phone', identities: { phone: ['+84912345678'] } },
    ...over,
  });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

let app: NestExpressApplication;
let pool: pg.Pool;
let keyServer: Server;
beforeAll(async () => {
  keyServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: KID }] }));
  });
  await new Promise<void>((r) => keyServer.listen(0, '127.0.0.1', r));
  Object.assign(process.env, {
    FIREBASE_PROJECT_ID: PROJECT,
    FIREBASE_API_KEY: 'AIzaTestKey',
    FIREBASE_AUTH_DOMAIN: `${PROJECT}.firebaseapp.com`,
    FIREBASE_APP_ID: '1:1:web:abc',
    FIREBASE_JWKS_URL: `http://127.0.0.1:${(keyServer.address() as AddressInfo).port}/keys`,
  });
  ({ app, pool } = await bootApp());
});
afterAll(async () => {
  await app.close();
  await pool.end();
  keyServer.close();
  for (const k of [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_API_KEY',
    'FIREBASE_AUTH_DOMAIN',
    'FIREBASE_APP_ID',
    'FIREBASE_JWKS_URL',
  ])
    delete process.env[k];
});
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE phone_otps, verified_phones, auth_challenges, outbox_events');
  await pool.query(
    `UPDATE site_settings SET value = '{"paymentWindowMinutes": 30, "requirePhoneVerification": true}' WHERE key = 'checkout'`,
  );
});

const post = (url: string, body: object) =>
  request(app.getHttpServer()).post(url).set('Origin', WEB_ORIGIN).send(body);

describe('Firebase Phone Auth', () => {
  it('announces itself, with the public web config only, on /auth/providers', async () => {
    const res = await request(app.getHttpServer()).get('/v1/auth/providers');
    const p = authProvidersSchema.parse(res.body);
    expect(p.phone).toEqual({
      provider: 'firebase',
      firebase: {
        apiKey: 'AIzaTestKey',
        authDomain: `${PROJECT}.firebaseapp.com`,
        projectId: PROJECT,
        appId: '1:1:web:abc',
      },
    });
  });

  describe('account phone', () => {
    const customer = async () => {
      const u = await createUser(pool, 'CUSTOMER');
      return as(app, await login(app, u.email));
    };

    it('marks the number from the signed token as verified, and no server-side code is sent any more', async () => {
      const api = await customer();
      const sms = await api.post('/v1/me/phone/otp').send({ phone: '0912345678' });
      expect(sms.status).toBe(409);
      expect(
        (await pool.query("SELECT 1 FROM outbox_events WHERE type = 'phone.otp'")).rowCount,
      ).toBe(0);

      const ok = await api.post('/v1/me/phone/firebase').send({ idToken: mint() });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toEqual({ phone: '+84 *** *** 678', verified: true });
      expect((await api.get('/v1/me/phone')).body).toEqual({
        phone: '+84 *** *** 678',
        verified: true,
      });
      const stored = await pool.query(
        'SELECT phone FROM users WHERE phone_verified_at IS NOT NULL',
      );
      expect(stored.rows[0].phone).toBe('+84912345678');
    });

    it('rejects a token that is forged, for another project, expired, stale, not from phone sign-in or for a foreign number', async () => {
      const api = await customer();
      const now = Math.floor(Date.now() / 1000);
      const bad: Record<string, string> = {
        'signed with another key': mint({}, other.privateKey),
        'unknown key id': mint({}, privateKey, 'nope'),
        'wrong project': mint({
          aud: 'someone-else',
          iss: 'https://securetoken.google.com/someone-else',
        }),
        'wrong issuer': mint({ iss: 'https://evil.example.com' }),
        expired: mint({ exp: now - 10 }),
        'sign-in too old': mint({ auth_time: now - 3600 }),
        'not a phone sign-in': mint({ firebase: { sign_in_provider: 'google.com' } }),
        'foreign number': mint({ phone_number: '+14155550123' }),
        'no number': mint({ phone_number: undefined }),
        garbage: 'a.b.c'.padEnd(120, 'x'),
        'tampered claims': (() => {
          const [h, , s] = mint().split('.');
          const claims = Buffer.from(
            JSON.stringify({
              iss: `https://securetoken.google.com/${PROJECT}`,
              aud: PROJECT,
              phone_number: '+84987654321',
            }),
          ).toString('base64url');
          return `${h}.${claims}.${s}`;
        })(),
      };
      for (const [why, idToken] of Object.entries(bad)) {
        const res = await api.post('/v1/me/phone/firebase').send({ idToken });
        expect(res.status, why).toBe(400);
      }
      expect((await api.get('/v1/me/phone')).body).toEqual({ phone: null, verified: false });
    });

    it('does not let two accounts own one number', async () => {
      const a = await customer();
      expect((await a.post('/v1/me/phone/firebase').send({ idToken: mint() })).status).toBe(200);
      const b = await customer();
      const res = await b.post('/v1/me/phone/firebase').send({ idToken: mint() });
      expect(res.status).toBe(409);
    });
  });

  describe('checkout', () => {
    it('lets a guest order once the receiving number is proven with a Firebase token', async () => {
      const r = await createProduct(pool, {
        categoryId: await createCategory(pool),
        variants: [{ price: 100_000, stock: 5 }],
      });
      const g = guest(app);
      await g.post('/v1/cart/items').send({ variantId: r.variantIds[0], quantity: 1 });
      const quote = quoteSchema.parse((await g.post('/v1/checkout/quote').send({})).body);
      const place = () =>
        g
          .post('/v1/orders')
          .set('Idempotency-Key', crypto.randomUUID())
          .send({
            shippingAddress: {
              fullName: 'Nguyễn Văn A',
              phone: '0912345678',
              line1: '12 Lê Lợi',
              ward: 'Bến Thành',
              district: 'Quận 1',
              province: 'TP. Hồ Chí Minh',
            },
            contactEmail: 'a@example.com',
            paymentMethod: 'COD',
            expectedTotalVnd: quote.totalVnd,
          });
      expect((await place()).body.error?.code).toBe('PHONE_NOT_VERIFIED');

      // a proof of another number does not help
      await g
        .post('/v1/checkout/phone/firebase')
        .send({ idToken: mint({ phone_number: '+84987654321' }) });
      expect((await place()).body.error?.code).toBe('PHONE_NOT_VERIFIED');

      const ok = await g.post('/v1/checkout/phone/firebase').send({ idToken: mint() });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toEqual({ phone: '+84912345678', verified: true });
      const placed = await place();
      expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    });
  });

  describe('sign-up and password reset by phone', () => {
    const begin = (identifier: string) =>
      post('/v1/auth/register/start', {
        fullName: 'Nguyễn Văn A',
        identifier,
        password: PASSWORD,
        confirmPassword: PASSWORD,
      });

    it('creates the account only when the token proves the typed number; nothing is queued for sending', async () => {
      const started = challengeSentSchema.parse((await begin('0912 345 678')).body);
      expect(started).toMatchObject({ channel: 'PHONE', provider: 'firebase' });
      expect(started.devCode).toBeUndefined();
      expect(
        (await pool.query("SELECT 1 FROM outbox_events WHERE type = 'phone.otp'")).rowCount,
      ).toBe(0);

      const wrongNumber = await post('/v1/auth/register/verify-firebase', {
        token: started.token,
        idToken: mint({ phone_number: '+84987654321' }),
      });
      expect(wrongNumber.status).toBe(400);
      expect((await pool.query('SELECT 1 FROM users WHERE phone IS NOT NULL')).rowCount).toBe(0);

      const ok = await post('/v1/auth/register/verify-firebase', {
        token: started.token,
        idToken: mint(),
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      const u = await pool.query(
        'SELECT phone, phone_verified_at FROM users WHERE phone IS NOT NULL',
      );
      expect(u.rows[0].phone).toBe('+84912345678');
      expect(u.rows[0].phone_verified_at).not.toBeNull();
      // single use
      const again = await post('/v1/auth/register/verify-firebase', {
        token: started.token,
        idToken: mint(),
      });
      expect(again.status).toBe(400);
    });

    it('resets a password by phone with a Firebase token, and not for a number without an account', async () => {
      const u = await createUser(pool, 'CUSTOMER');
      await pool.query(
        "UPDATE users SET phone = '+84912345678', phone_verified_at = now() WHERE id = $1",
        [u.id],
      );
      const known = (await post('/v1/auth/forgot-password', { identifier: '0912345678' })).body;
      const unknown = (await post('/v1/auth/forgot-password', { identifier: '0987654321' })).body;
      expect(known.provider).toBe('firebase');
      expect(unknown.provider).toBe('firebase'); // same answer either way
      const reset = (token: string, idToken: string) =>
        post('/v1/auth/reset-password/phone', {
          token,
          idToken,
          newPassword: 'a-brand-new-password',
          confirmPassword: 'a-brand-new-password',
        });
      expect((await reset(known.token, mint({ phone_number: '+84333333333' }))).status).toBe(400);
      expect((await reset(unknown.token, mint({ phone_number: '+84987654321' }))).status).toBe(400); // no account behind it
      expect((await reset(known.token, mint())).status).toBe(204);
      expect(
        (await post('/v1/auth/login', { email: '0912345678', password: 'a-brand-new-password' }))
          .status,
      ).toBe(200);
    });
  });
});
