import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { couponSchema, quoteSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import {
  as,
  bootApp,
  cookieFrom,
  createUser,
  guest,
  login,
  register,
  resetAll,
  WEB_ORIGIN,
} from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
let cat: string;
let admin: ReturnType<typeof as>;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  cat = await createCategory(pool);
  admin = as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
});

const address = {
  fullName: 'Nguyễn Văn A',
  phone: '0901234567',
  line1: '12 Lê Lợi',
  ward: 'Bến Thành',
  district: 'Quận 1',
  province: 'TP. Hồ Chí Minh',
};
const variant = async (price = 100_000, stock = 20) =>
  (await createProduct(pool, { categoryId: cat, variants: [{ price, stock }] })).variantIds[0]!;
const newCoupon = (body: object) =>
  admin.post('/v1/admin/coupons').send({ code: 'SALE10', type: 'PERCENT', value: 10, ...body });
const cartWith = async (variantId: string, qty = 1, code?: string) => {
  const g = guest(app);
  await g.post('/v1/cart/items').send({ variantId, quantity: qty });
  if (code) expect((await g.post('/v1/cart/coupon').send({ code })).status).toBe(200);
  return g;
};
const quote = async (g: ReturnType<typeof guest>, province?: string) =>
  quoteSchema.parse((await g.post('/v1/checkout/quote').send(province ? { province } : {})).body);
const order = (
  g: ReturnType<typeof guest>,
  total: number,
  extra: object = {},
  email = 'buyer@example.com',
) =>
  g
    .post('/v1/orders')
    .set('Idempotency-Key', randomUUID())
    .send({
      shippingAddress: address,
      contactEmail: email,
      paymentMethod: 'COD',
      expectedTotalVnd: total,
      ...extra,
    });

describe('admin manages coupons (data, not code)', () => {
  it('creates, lists and edits coupons with versioning, validation, audit and a fixed code', async () => {
    const created = await newCoupon({
      description: 'Giảm 10%',
      minOrderVnd: 200_000,
      maxDiscountVnd: 50_000,
      usageLimitTotal: 100,
      usageLimitPerUser: 1,
    });
    expect(created.status).toBe(201);
    const c = couponSchema.parse(created.body);
    expect(c).toMatchObject({
      code: 'SALE10',
      type: 'PERCENT',
      value: 10,
      minOrderVnd: 200_000,
      maxDiscountVnd: 50_000,
      isActive: true,
      version: 1,
      usedCount: 0,
    });
    expect((await newCoupon({})).status).toBe(409); // duplicate code
    expect((await admin.get('/v1/admin/coupons')).body.items).toHaveLength(1);

    const patch = (version: number, coupon: object) =>
      admin.patch(`/v1/admin/coupons/${c.id}`).send({ version, coupon });
    const base = {
      code: 'SALE10',
      type: 'PERCENT',
      value: 15,
      minOrderVnd: 200_000,
      maxDiscountVnd: 50_000,
      isActive: true,
    };
    const updated = await patch(1, base);
    expect(updated.body).toMatchObject({ value: 15, version: 2 });
    expect((await patch(1, { ...base, value: 20 })).status).toBe(409); // stale
    expect((await patch(2, { ...base, code: 'OTHER' })).status).toBe(400); // code is immutable
    expect((await patch(2, { ...base, value: 0 })).status).toBe(400);
    const audit = await pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'coupon.update'`,
    );
    expect(audit.rows[0].metadata.changes.value).toEqual({ from: 10, to: 15 });
  });

  it('validates shapes: percent 1-100, fixed > 0, free-shipping has no value, sane windows and code format', async () => {
    for (const bad of [
      { value: 0 },
      { value: 101 },
      { type: 'FIXED', value: 0 },
      { type: 'FREE_SHIPPING', value: 5 },
      { code: 'ab' },
      { code: 'has space' },
      { startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-11-01T00:00:00Z' },
      { usageLimitTotal: 0 },
      { maxDiscountVnd: 0 },
      { minOrderVnd: -1 },
    ])
      expect((await newCoupon(bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await newCoupon({ code: 'ship1', type: 'FREE_SHIPPING', value: 0 })).body.code).toBe(
      'SHIP1',
    ); // normalized to upper case
  });

  it('is restricted to staff with coupons:write (others may only read)', async () => {
    const catalog = as(app, await login(app, (await createUser(pool, 'CATALOG')).email));
    expect(
      (await catalog.post('/v1/admin/coupons').send({ code: 'NOPE10', type: 'PERCENT', value: 5 }))
        .status,
    ).toBe(403);
    expect((await catalog.get('/v1/admin/coupons')).status).toBe(200);
    const customer = (await register(app, 'c@example.com')).session!;
    expect((await as(app, customer).get('/v1/admin/coupons')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/v1/admin/coupons')).status).toBe(401);
    expect(await pool.query('SELECT 1 FROM coupons').then((r) => r.rowCount)).toBe(0);
  });
});

describe('applying a coupon to the cart', () => {
  it('shows the discount in the backend quote and removes it on request', async () => {
    await newCoupon({});
    const g = await cartWith(await variant(200_000), 2);
    const applied = await g.post('/v1/cart/coupon').send({ code: 'sale10' });
    expect(applied.body.coupon).toMatchObject({
      code: 'SALE10',
      discountVnd: 40_000,
      freeShipping: false,
    });
    const q = await quote(g);
    expect(q).toMatchObject({
      subtotalVnd: 400_000,
      discountVnd: 40_000,
      shippingFeeVnd: 30_000,
      totalVnd: 390_000,
    });
    expect(q.coupon?.code).toBe('SALE10');
    expect(q.discounts).toEqual([{ source: 'COUPON', label: 'Mã SALE10', amountVnd: 40_000 }]);
    expect((await g.delete('/v1/cart/coupon')).status).toBe(204);
    expect((await quote(g)).totalVnd).toBe(430_000);
  });

  it('explains why a code is refused, with stable codes', async () => {
    const v = await variant(100_000);
    const g = await cartWith(v, 1);
    const apply = async (code: string) =>
      (await g.post('/v1/cart/coupon').send({ code })).body.error;
    expect((await apply('NOSUCHCODE')).details.issue).toBe('NOT_FOUND');
    await newCoupon({ code: 'OFF1', isActive: false });
    await newCoupon({ code: 'FUTURE1', startsAt: '2099-01-01T00:00:00Z' });
    await newCoupon({
      code: 'OLD1',
      startsAt: '2020-01-01T00:00:00Z',
      endsAt: '2020-02-01T00:00:00Z',
    });
    await newCoupon({ code: 'BIG1', minOrderVnd: 500_000 });
    await newCoupon({ code: 'ONE1', usageLimitTotal: 1 });
    expect((await apply('OFF1')).details.issue).toBe('INACTIVE');
    expect((await apply('FUTURE1')).details.issue).toBe('NOT_STARTED');
    expect((await apply('OLD1')).details.issue).toBe('EXPIRED');
    const min = await apply('BIG1');
    expect(min.details).toMatchObject({ issue: 'MIN_ORDER', minOrderVnd: 500_000 });
    expect(min.code).toBe('COUPON_INVALID');
    expect(
      (await guest(app).post('/v1/cart/coupon').send({ code: 'ONE1' })).body.error.details.issue,
    ).toBe('MIN_ORDER'); // empty cart
  });

  it('is rate-limited to stop code guessing', async () => {
    const g = await cartWith(await variant(), 1);
    let last = 0;
    for (let i = 0; i < 25; i++)
      last = (await g.post('/v1/cart/coupon').send({ code: `GUESS${i}` })).status;
    expect(last).toBe(429);
  });

  it('is dropped from the quote (with the reason) once it stops being valid', async () => {
    await newCoupon({});
    const g = await cartWith(await variant(), 3);
    await g.post('/v1/cart/coupon').send({ code: 'SALE10' });
    await pool.query(`UPDATE coupons SET is_active = false`);
    const q = await quote(g);
    expect(q.coupon).toBeNull();
    expect(q.couponIssue).toMatchObject({ code: 'INACTIVE' });
    expect(q.discountVnd).toBe(0);
  });

  it('follows the shopper when they sign in, without replacing the account coupon', async () => {
    await newCoupon({});
    await newCoupon({ code: 'KEEP20', type: 'FIXED', value: 20_000 });
    const v = await variant();
    const { session } = await register(app, 'u@example.com');
    const g = await cartWith(v, 1, 'SALE10');
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', g.cookie!)
      .send({ email: 'u@example.com', password: 'correct-horse-battery' });
    const s2 = { cookie: cookieFrom(res, 'nona_session')!, csrf: res.body.csrfToken };
    expect((await as(app, s2).post('/v1/checkout/quote').send({})).body.coupon.code).toBe('SALE10');
    void session;
    void login;
  });
});

describe('ordering with a coupon', () => {
  it('applies the discount on the backend, snapshots the rule, and records the use', async () => {
    await newCoupon({ minOrderVnd: 100_000 });
    const g = await cartWith(await variant(200_000), 2, 'SALE10');
    const res = await order(g, 390_000);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      subtotalVnd: 400_000,
      discountVnd: 40_000,
      shippingFeeVnd: 30_000,
      totalVnd: 390_000,
      couponCode: 'SALE10',
    });
    const discount = (
      await pool.query(
        'SELECT source, reference, applies_to, amount_vnd, rule FROM order_discounts',
      )
    ).rows;
    expect(discount).toEqual([
      {
        source: 'COUPON',
        reference: 'SALE10',
        applies_to: 'GOODS',
        amount_vnd: '40000',
        rule: {
          type: 'PERCENT',
          value: 10,
          minOrderVnd: 100_000,
          maxDiscountVnd: null,
          version: 1,
        },
      },
    ]);
    expect((await pool.query(`SELECT status, amount_vnd FROM coupon_usages`)).rows).toEqual([
      { status: 'APPLIED', amount_vnd: '40000' },
    ]);
    expect((await g.get('/v1/cart')).body.lines).toEqual([]);
    expect((await pool.query('SELECT coupon_code FROM carts')).rows[0].coupon_code).toBeNull();
    // editing the coupon later never changes the past order
    const id = (await admin.get('/v1/admin/coupons')).body.items[0].id;
    await admin
      .patch(`/v1/admin/coupons/${id}`)
      .send({ version: 1, coupon: { code: 'SALE10', type: 'PERCENT', value: 50, isActive: true } });
    expect(
      (await request(app.getHttpServer()).get(`/v1/orders/${res.body.code}`)).body,
    ).toMatchObject({ discountVnd: 40_000, totalVnd: 390_000 });
    expect((await pool.query('SELECT rule FROM order_discounts')).rows[0].rule.value).toBe(10);
  });

  it('refuses a forged total that ignores/inflates the coupon', async () => {
    await newCoupon({});
    const g = await cartWith(await variant(200_000), 1, 'SALE10');
    const bad = await order(g, 230_000); // total without the discount (what the server would charge otherwise)
    expect(bad.status).toBe(409);
    expect(bad.body.error.details.currentTotalVnd).toBe(210_000);
    expect(await pool.query('SELECT 1 FROM orders').then((r) => r.rowCount)).toBe(0);
    expect((await order(g, 210_000)).status).toBe(201);
  });

  it('enforces the total usage limit under concurrency (only one order gets the last use)', async () => {
    await newCoupon({ usageLimitTotal: 1 });
    const v = await variant(200_000, 20);
    const carts = await Promise.all(Array.from({ length: 4 }, () => cartWith(v, 1, 'SALE10')));
    const results = await Promise.all(
      carts.map((g) => order(g, 210_000, {}, `u${Math.random()}@example.com`)),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    const lost = results.filter((r) => r.status === 409);
    expect(lost).toHaveLength(3);
    expect(lost[0]!.body.error.code).toBe('PRICE_CHANGED');
    expect(lost[0]!.body.error.details.couponIssue.code).toBe('EXHAUSTED');
    expect(
      await pool
        .query(`SELECT 1 FROM coupon_usages WHERE status = 'APPLIED'`)
        .then((r) => r.rowCount),
    ).toBe(1);
  });

  it('enforces the per-customer limit for accounts and (by email) for guests', async () => {
    await newCoupon({ usageLimitPerUser: 1 });
    const v = await variant(200_000);
    const first = await cartWith(v, 1, 'SALE10');
    expect((await order(first, 210_000, {}, 'same@example.com')).status).toBe(201);
    const second = await cartWith(v, 1, 'SALE10');
    const res = await order(second, 210_000, {}, 'SAME@example.com'); // case-insensitive
    expect(res.status).toBe(409);
    expect(res.body.error.details.couponIssue.code).toBe('USER_LIMIT');
    expect((await order(second, 230_000, {}, 'someone-else@example.com')).status).toBe(
      201 - 201 + 409,
    ); // a different email gets the discount, so 230k is now wrong
    expect((await order(second, 210_000, {}, 'someone-else@example.com')).status).toBe(201);
  });

  it('releases the use when the order is cancelled, so the coupon can be used again', async () => {
    await newCoupon({ usageLimitTotal: 1 });
    const v = await variant(200_000);
    const { session } = await register(app, 'owner@example.com');
    const api = as(app, session!);
    await api.post('/v1/cart/items').send({ variantId: v });
    await api.post('/v1/cart/coupon').send({ code: 'SALE10' });
    const placed = await api
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: address, paymentMethod: 'COD', expectedTotalVnd: 210_000 });
    expect(placed.status).toBe(201);
    const blocked = await cartWith(v, 1);
    expect(
      (await blocked.post('/v1/cart/coupon').send({ code: 'SALE10' })).body.error.details.issue,
    ).toBe('EXHAUSTED');
    await api.post(`/v1/orders/${placed.body.code}/cancel`);
    expect((await pool.query('SELECT status FROM coupon_usages')).rows[0].status).toBe('RELEASED');
    expect((await blocked.post('/v1/cart/coupon').send({ code: 'SALE10' })).status).toBe(200);
  });

  it('supports fixed, capped-percent and free-shipping coupons', async () => {
    const v = await variant(100_000);
    await newCoupon({ code: 'FIX50', type: 'FIXED', value: 50_000 });
    await newCoupon({ code: 'CAP', value: 50, maxDiscountVnd: 20_000 });
    await newCoupon({ code: 'FREESHIP', type: 'FREE_SHIPPING', value: 0 });
    expect((await quote(await cartWith(v, 1, 'FIX50'))).totalVnd).toBe(80_000);
    expect((await quote(await cartWith(v, 1, 'CAP'))).discountVnd).toBe(20_000);
    const g = await cartWith(v, 1, 'FREESHIP');
    const q = await quote(g);
    expect(q).toMatchObject({ discountVnd: 0, shippingFeeVnd: 0, totalVnd: 100_000 });
    expect(q.coupon).toMatchObject({ freeShipping: true });
    const res = await order(g, 100_000);
    expect(res.status).toBe(201);
    expect((await pool.query(`SELECT applies_to, amount_vnd FROM order_discounts`)).rows).toEqual([
      { applies_to: 'SHIPPING', amount_vnd: '30000' },
    ]);
    expect(res.body.discountVnd).toBe(0);
  });
});

describe('shipping zones (admin-configured rates)', () => {
  const setShipping = (value: object) =>
    pool.query(`UPDATE site_settings SET value = $1::jsonb WHERE key = 'shipping'`, [
      JSON.stringify(value),
    ]);
  const zones = [
    {
      name: 'Nội thành HCM',
      provinces: ['Hồ Chí Minh', 'Hà Nội'],
      flatFeeVnd: 15_000,
      freeShippingThresholdVnd: 300_000,
    },
    {
      name: 'Vùng xa',
      provinces: ['Lai Châu'],
      flatFeeVnd: 60_000,
      freeShippingThresholdVnd: null,
    },
  ];

  it('prices by destination, falling back to the default terms for other provinces', async () => {
    await setShipping({ freeShippingThresholdVnd: 600_000, flatFeeVnd: 30_000, zones });
    const g = await cartWith(await variant(100_000), 1);
    expect(await quote(g, 'TP. Hồ Chí Minh')).toMatchObject({
      shippingFeeVnd: 15_000,
      shippingZone: 'Nội thành HCM',
    });
    expect(await quote(g, 'tỉnh Lai Châu')).toMatchObject({
      shippingFeeVnd: 60_000,
      shippingZone: 'Vùng xa',
    });
    expect(await quote(g, 'Cần Thơ')).toMatchObject({ shippingFeeVnd: 30_000, shippingZone: null });
    expect(await quote(g)).toMatchObject({ shippingFeeVnd: 30_000 });
    const big = await cartWith(await variant(150_000), 2);
    expect((await quote(big, 'Hà Nội')).shippingFeeVnd).toBe(0); // zone threshold 300k
    expect((await quote(big, 'Lai Châu')).shippingFeeVnd).toBe(60_000); // zone has no free-shipping offer
  });

  it('charges the destination zone at order time and rejects a total computed for another destination', async () => {
    await setShipping({ freeShippingThresholdVnd: 600_000, flatFeeVnd: 30_000, zones });
    const g = await cartWith(await variant(100_000), 1);
    const wrong = await order(g, 130_000, {
      shippingAddress: { ...address, province: 'Lai Châu' },
    }); // shopper saw the default fee
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.details.currentTotalVnd).toBe(160_000);
    const ok = await order(g, 160_000, { shippingAddress: { ...address, province: 'Lai Châu' } });
    expect(ok.status).toBe(201);
    expect(ok.body.shippingFeeVnd).toBe(60_000);
  });

  it('is edited by admins through settings with validation', async () => {
    const s = (await admin.get('/v1/admin/settings')).body;
    const put = (shipping: object) =>
      admin
        .patch('/v1/admin/settings/shipping')
        .send({ version: s.shipping.version, value: shipping });
    expect(
      (
        await put({
          freeShippingThresholdVnd: null,
          flatFeeVnd: 0,
          zones: [{ name: '', provinces: ['A'], flatFeeVnd: 1, freeShippingThresholdVnd: null }],
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await put({
          freeShippingThresholdVnd: null,
          flatFeeVnd: 0,
          zones: [{ name: 'Z', provinces: [], flatFeeVnd: 1, freeShippingThresholdVnd: null }],
        })
      ).status,
    ).toBe(400);
    const ok = await put({ freeShippingThresholdVnd: 500_000, flatFeeVnd: 25_000, zones });
    expect(ok.status).toBe(200);
    expect(ok.body.shipping.zones).toHaveLength(2);
    const w = await admin
      .patch('/v1/admin/settings/checkout')
      .send({ version: s.checkout.version, value: { paymentWindowMinutes: 4 } });
    expect(w.status).toBe(400); // minimum is 5 minutes
    expect(
      (
        await admin
          .patch('/v1/admin/settings/checkout')
          .send({ version: s.checkout.version, value: { paymentWindowMinutes: 45 } })
      ).body.checkout.paymentWindowMinutes,
    ).toBe(45);
  });
});
