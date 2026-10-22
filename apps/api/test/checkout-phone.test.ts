import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { quoteSchema } from '@nona/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import { as, bootApp, createUser, guest, login, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE phone_otps, verified_phones, outbox_events');
  await pool.query(
    `UPDATE site_settings SET value = '{"paymentWindowMinutes": 30, "requirePhoneVerification": true}' WHERE key = 'checkout'`,
  );
});

const PHONE = '0912345678';
const address = {
  fullName: 'Nguyễn Văn A',
  phone: PHONE,
  line1: '12 Lê Lợi',
  ward: 'Bến Thành',
  district: 'Quận 1',
  province: 'TP. Hồ Chí Minh',
};
const stocked = async () => {
  const r = await createProduct(pool, {
    categoryId: await createCategory(pool),
    variants: [{ price: 100_000, stock: 10 }],
  });
  return r.variantIds[0]!;
};
const order = (g: ReturnType<typeof guest>, total = 130_000) =>
  g.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
    shippingAddress: address,
    contactEmail: 'a@example.com',
    paymentMethod: 'COD',
    expectedTotalVnd: total,
  });

describe('phone verification before ordering', () => {
  it('refuses to place an order until the receiving phone is verified, then accepts it (guest)', async () => {
    const variantId = await stocked();
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId, quantity: 1 });
    const quote = quoteSchema.parse((await g.post('/v1/checkout/quote').send({})).body);
    expect(quote.phoneVerificationRequired).toBe(true);

    const blocked = await order(g, quote.totalVnd);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect((await pool.query('SELECT 1 FROM orders')).rowCount).toBe(0);

    expect((await g.get(`/v1/checkout/phone?phone=${PHONE}`)).body).toMatchObject({
      verified: false,
    });
    const sent = await g.post('/v1/checkout/phone/otp').send({ phone: PHONE });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    const bad = await g
      .post('/v1/checkout/phone/verify')
      .send({ code: sent.body.devCode === '000000' ? '111111' : '000000' });
    expect(bad.status).toBe(400);
    const ok = await g.post('/v1/checkout/phone/verify').send({ code: sent.body.devCode });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect((await g.get(`/v1/checkout/phone?phone=0912%20345%20678`)).body).toMatchObject({
      verified: true,
    });

    const placed = await order(g, quote.totalVnd);
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  });

  it('a verified number does not cover a different number', async () => {
    const variantId = await stocked();
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId, quantity: 1 });
    const sent = await g.post('/v1/checkout/phone/otp').send({ phone: PHONE });
    await g.post('/v1/checkout/phone/verify').send({ code: sent.body.devCode });
    const other = await g
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        shippingAddress: { ...address, phone: '0987654321' },
        contactEmail: 'a@example.com',
        paymentMethod: 'COD',
        expectedTotalVnd: 130_000,
      });
    expect(other.body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it("one guest's proof is useless to another browser", async () => {
    const variantId = await stocked();
    const a = guest(app);
    await a.post('/v1/cart/items').send({ variantId, quantity: 1 });
    const sent = await a.post('/v1/checkout/phone/otp').send({ phone: PHONE });
    await a.post('/v1/checkout/phone/verify').send({ code: sent.body.devCode });
    const b = guest(app);
    await b.post('/v1/cart/items').send({ variantId, quantity: 1 });
    expect((await order(b)).body.error.code).toBe('PHONE_NOT_VERIFIED');
    expect((await b.get(`/v1/checkout/phone?phone=${PHONE}`)).body.verified).toBe(false);
  });

  it('expires a guest proof after 24 hours', async () => {
    const variantId = await stocked();
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId, quantity: 1 });
    const sent = await g.post('/v1/checkout/phone/otp').send({ phone: PHONE });
    await g.post('/v1/checkout/phone/verify').send({ code: sent.body.devCode });
    await pool.query("UPDATE verified_phones SET verified_at = now() - interval '25 hours'");
    expect((await order(g)).body.error.code).toBe('PHONE_NOT_VERIFIED');
  });

  it('works for a signed-in user, and the account phone counts as verified', async () => {
    const variantId = await stocked();
    const u = await createUser(pool, 'CUSTOMER');
    const api = as(app, await login(app, u.email));
    await api.post('/v1/cart/items').send({ variantId, quantity: 1 });
    const placeBody = {
      shippingAddress: address,
      paymentMethod: 'COD',
      expectedTotalVnd: 130_000,
    };
    const place = () => api.post('/v1/orders').set('Idempotency-Key', randomUUID()).send(placeBody);
    expect((await place()).body.error.code).toBe('PHONE_NOT_VERIFIED');
    const sent = await api.post('/v1/me/phone/otp').send({ phone: PHONE });
    await api.post('/v1/me/phone/verify').send({ code: sent.body.devCode });
    const placed = await place();
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
  });

  it('an account OTP cannot be used to verify at checkout and vice versa', async () => {
    const u = await createUser(pool, 'CUSTOMER');
    const api = as(app, await login(app, u.email));
    const variantId = await stocked();
    await api.post('/v1/cart/items').send({ variantId, quantity: 1 });
    const sent = await api.post('/v1/me/phone/otp').send({ phone: PHONE });
    expect(
      (await api.post('/v1/checkout/phone/verify').send({ code: sent.body.devCode })).status,
    ).toBe(400);
  });

  it('can be switched off by the admin setting', async () => {
    await pool.query(
      `UPDATE site_settings SET value = '{"paymentWindowMinutes": 30, "requirePhoneVerification": false}' WHERE key = 'checkout'`,
    );
    const variantId = await stocked();
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId, quantity: 1 });
    expect(
      quoteSchema.parse((await g.post('/v1/checkout/quote').send({})).body)
        .phoneVerificationRequired,
    ).toBe(false);
    expect((await order(g)).status).toBe(201);
  });

  it('needs a cart to verify a guest number', async () => {
    const g = guest(app);
    expect((await g.post('/v1/checkout/phone/otp').send({ phone: PHONE })).status).toBe(409);
  });
});
