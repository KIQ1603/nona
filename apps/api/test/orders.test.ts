import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminOrderDetailSchema, orderSchema, quoteSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addStock, createCategory, createProduct } from './factories';
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
  type Session,
} from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
let cat: string;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  cat = await createCategory(pool);
});

const address = {
  fullName: 'Nguyễn Văn A',
  phone: '0901234567',
  line1: '12 Lê Lợi',
  ward: 'Bến Thành',
  district: 'Quận 1',
  province: 'TP. Hồ Chí Minh',
};
const variant = async (
  o: {
    price?: number;
    stock?: number;
    slug?: string;
    name?: string;
    status?: 'PUBLISHED' | 'DRAFT';
  } = {},
) => {
  const r = await createProduct(pool, {
    categoryId: cat,
    slug: o.slug,
    name: o.name,
    status: o.status,
    variants: [{ price: o.price ?? 100_000, stock: o.stock ?? 10 }],
  });
  return { id: r.variantIds[0]!, productId: r.productId };
};
const ledger = async (variantId: string) =>
  Number(
    (
      await pool.query(
        'SELECT COALESCE(SUM(delta),0) s FROM inventory_movements WHERE variant_id=$1',
        [variantId],
      )
    ).rows[0].s,
  );
const count = async (table: string) =>
  Number((await pool.query(`SELECT COUNT(*) n FROM ${table}`)).rows[0].n);
const body = (expectedTotalVnd: number, extra: object = {}) => ({
  shippingAddress: address,
  contactEmail: 'khach@example.com',
  paymentMethod: 'COD',
  expectedTotalVnd,
  ...extra,
});

async function guestWithCart(items: [{ id: string }, number][]) {
  const g = guest(app);
  for (const [v, q] of items) await g.post('/v1/cart/items').send({ variantId: v.id, quantity: q });
  return g;
}
const place = (g: ReturnType<typeof guest>, b: object, key = randomUUID()) =>
  g.post('/v1/orders').set('Idempotency-Key', key).send(b);

describe('POST /v1/checkout/quote', () => {
  it('is computed by the backend from live prices and admin-configured shipping', async () => {
    const v = await variant({ price: 190_000 });
    const g = await guestWithCart([[v, 2]]);
    const q = quoteSchema.parse((await g.post('/v1/checkout/quote')).body);
    expect(q).toMatchObject({
      subtotalVnd: 380_000,
      shippingFeeVnd: 30_000,
      totalVnd: 410_000,
      canCheckout: true,
    });
    expect(q.freeShipping).toEqual({
      thresholdVnd: 600_000,
      remainingVnd: 220_000,
      applied: false,
    });

    await pool.query(
      `UPDATE site_settings SET value = '{"freeShippingThresholdVnd": 300000, "flatFeeVnd": 45000}' WHERE key = 'shipping'`,
    );
    const free = quoteSchema.parse((await g.post('/v1/checkout/quote')).body);
    expect(free).toMatchObject({ shippingFeeVnd: 0, totalVnd: 380_000 });
    await pool.query(
      `UPDATE site_settings SET value = '{"freeShippingThresholdVnd": null, "flatFeeVnd": 45000}' WHERE key = 'shipping'`,
    );
    expect(quoteSchema.parse((await g.post('/v1/checkout/quote')).body).shippingFeeVnd).toBe(
      45_000,
    );
  });

  it('blocks checkout for an empty cart and for unavailable lines, with reasons', async () => {
    const empty = quoteSchema.parse((await guest(app).post('/v1/checkout/quote')).body);
    expect(empty).toMatchObject({ canCheckout: false, totalVnd: 0 });
    expect(empty.blockers[0]!.code).toBe('CART_EMPTY');
    const ok = await variant({ slug: 'ok' });
    const gone = await variant({ slug: 'gone', stock: 5 });
    const g = await guestWithCart([
      [ok, 1],
      [gone, 2],
    ]);
    await addStock(pool, gone.id, -5, 'SALE');
    const q = quoteSchema.parse((await g.post('/v1/checkout/quote')).body);
    expect(q.canCheckout).toBe(false);
    expect(q.blockers.map((b) => b.code)).toEqual(['OUT_OF_STOCK']);
    expect(q.subtotalVnd).toBe(100_000);
  });
});

describe('POST /v1/orders (COD)', () => {
  it('creates one atomic order: totals, snapshot, stock sale, payment, history, outbox, emptied cart', async () => {
    const v = await variant({ price: 100_000, stock: 5, name: 'Nón Sen', slug: 'non-sen' });
    const g = await guestWithCart([[v, 2]]);
    const res = await place(g, body(230_000));
    expect(res.status).toBe(201);
    const order = orderSchema.parse(res.body);
    expect(order).toMatchObject({
      status: 'CONFIRMED',
      paymentMethod: 'COD',
      paymentStatus: 'PENDING',
      subtotalVnd: 200_000,
      shippingFeeVnd: 30_000,
      totalVnd: 230_000,
      isOwner: false,
    });
    expect(order.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(order.items[0]).toMatchObject({
      productName: 'Nón Sen',
      unitPriceVnd: 100_000,
      quantity: 2,
      lineTotalVnd: 200_000,
    });
    expect(order.history.map((h) => h.status)).toEqual(['CONFIRMED']);

    expect(await ledger(v.id)).toBe(3); // 5 - 2, written as an append-only SALE movement
    expect(
      (
        await pool.query(
          `SELECT delta, reason, reference FROM inventory_movements WHERE reason = 'SALE'`,
        )
      ).rows[0],
    ).toEqual({ delta: -2, reason: 'SALE', reference: `order:${order.code}` });
    expect((await pool.query(`SELECT status, quantity FROM inventory_reservations`)).rows).toEqual([
      { status: 'CONSUMED', quantity: 2 },
    ]);
    expect((await pool.query(`SELECT provider, status, amount_vnd FROM payments`)).rows[0]).toEqual(
      { provider: 'COD', status: 'PENDING', amount_vnd: '230000' },
    );
    expect((await g.get('/v1/cart')).body.lines).toEqual([]);
    const outbox = (await pool.query(`SELECT type, status, payload FROM outbox_events`)).rows;
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ type: 'order.placed', status: 'PENDING' });
    expect(outbox[0].payload).toMatchObject({
      orderCode: order.code,
      email: 'khach@example.com',
      totalVnd: 230_000,
    });
  });

  it('keeps the purchased snapshot when the product is later renamed, repriced or archived', async () => {
    const v = await variant({ price: 100_000, name: 'Tên Cũ', slug: 'cu' });
    const g = await guestWithCart([[v, 1]]);
    const code = (await place(g, body(130_000))).body.code;
    await pool.query(`UPDATE products SET name = 'Tên Mới', status = 'ARCHIVED' WHERE id = $1`, [
      v.productId,
    ]);
    await pool.query('UPDATE product_variants SET price_vnd = 999999 WHERE id = $1', [v.id]);
    const again = orderSchema.parse(
      (await request(app.getHttpServer()).get(`/v1/orders/${code}`)).body,
    );
    expect(again.items[0]).toMatchObject({
      productName: 'Tên Cũ',
      unitPriceVnd: 100_000,
      lineTotalVnd: 100_000,
    });
    expect(again.totalVnd).toBe(130_000);
  });

  it('never trusts the browser total: a stale/forged total gets 409 PRICE_CHANGED and nothing happens', async () => {
    const v = await variant({ price: 100_000, stock: 5 });
    const g = await guestWithCart([[v, 1]]);
    const forged = await place(g, body(1)); // attacker claims a 1đ total
    expect(forged.status).toBe(409);
    expect(forged.body.error.code).toBe('PRICE_CHANGED');
    expect(forged.body.error.details).toMatchObject({
      currentTotalVnd: 130_000,
      expectedTotalVnd: 1,
    });
    expect(await count('orders')).toBe(0);
    expect(await ledger(v.id)).toBe(5);
    expect((await g.get('/v1/cart')).body.itemCount).toBe(1); // cart untouched

    // price rises after the shopper saw the quote
    await pool.query('UPDATE product_variants SET price_vnd = 120000 WHERE id = $1', [v.id]);
    const stale = await place(g, body(130_000));
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentTotalVnd).toBe(150_000);
    expect((await place(g, body(150_000))).status).toBe(201);
  });

  it('is idempotent: the same key creates exactly one order and replays the response', async () => {
    const v = await variant({ stock: 5 });
    const g = await guestWithCart([[v, 1]]);
    const key = randomUUID();
    const first = await place(g, body(130_000), key);
    const retry = await place(g, body(130_000), key);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.code).toBe(first.body.code);
    expect(await count('orders')).toBe(1);
    expect(await ledger(v.id)).toBe(4);
    expect(await count('outbox_events')).toBe(1);
    const reuse = await place(g, body(130_000, { customerNote: 'different' }), key);
    expect(reuse.status).toBe(409);
    expect(reuse.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('survives a burst of identical concurrent submissions (double click)', async () => {
    const v = await variant({ stock: 5 });
    const g = await guestWithCart([[v, 1]]);
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => place(g, body(130_000), key)),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(new Set(results.map((r) => r.body.code)).size).toBe(1);
    expect(await count('orders')).toBe(1);
    expect(await ledger(v.id)).toBe(4);
  });

  it('requires an Idempotency-Key, a payment method, an address and (for guests) an email', async () => {
    const v = await variant();
    const g = await guestWithCart([[v, 1]]);
    expect((await g.post('/v1/orders').send(body(130_000))).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    expect((await place(g, { ...body(130_000), paymentMethod: 'BITCOIN' })).status).toBe(400);
    expect((await place(g, { ...body(130_000), shippingAddress: undefined })).status).toBe(400);
    expect((await place(g, { ...body(130_000), contactEmail: undefined })).status).toBe(400);
    expect(
      (await place(g, { ...body(130_000), shippingAddress: { ...address, phone: '123' } })).status,
    ).toBe(400);
    expect((await place(g, { ...body(130_000), expectedTotalVnd: 130000.5 })).status).toBe(400);
    expect(await count('orders')).toBe(0);
  });

  it('rejects an empty cart and unavailable items without side effects', async () => {
    expect((await place(guest(app), body(0))).body.error.code).toBe('CART_EMPTY');
    const v = await variant({ stock: 3 });
    const draft = await variant({ slug: 'draft' });
    const g = await guestWithCart([
      [v, 3],
      [draft, 1],
    ]);
    await pool.query(`UPDATE products SET status = 'DRAFT' WHERE id = $1`, [draft.productId]);
    const res = await place(g, body(430_000));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVENTORY_INSUFFICIENT');
    expect(res.body.error.details.items[0]).toMatchObject({ reason: 'UNAVAILABLE' });
    expect(await count('orders')).toBe(0);
    expect(await ledger(v.id)).toBe(3);
  });

  it('lets only one of two competing checkouts take the last unit (never oversells)', async () => {
    const v = await variant({ stock: 1 });
    const a = await guestWithCart([[v, 1]]);
    const b = await guestWithCart([[v, 1]]);
    const [ra, rb] = await Promise.all([place(a, body(130_000)), place(b, body(130_000))]);
    const statuses = [ra.status, rb.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = ra.status === 409 ? ra : rb;
    expect(loser.body.error.code).toBe('INVENTORY_INSUFFICIENT');
    expect(await count('orders')).toBe(1);
    expect(await ledger(v.id)).toBe(0);
  });

  it('holds up under many concurrent buyers of a small stock', async () => {
    const v = await variant({ stock: 3 });
    const buyers = await Promise.all(Array.from({ length: 8 }, () => guestWithCart([[v, 1]])));
    const results = await Promise.all(buyers.map((g) => place(g, body(130_000))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await ledger(v.id)).toBe(0);
    expect(await count('orders')).toBe(3);
  });

  it('counts active reservations against availability; expired ones free the stock again', async () => {
    const v = await variant({ stock: 2, slug: 'held' });
    await pool.query(
      `INSERT INTO inventory_reservations (variant_id, quantity, status, expires_at) VALUES ($1, 2, 'ACTIVE', now() + interval '10 minutes')`,
      [v.id],
    );
    const g = guest(app);
    expect((await g.post('/v1/cart/items').send({ variantId: v.id })).status).toBe(409); // fully held
    expect((await request(app.getHttpServer()).get('/v1/products/held')).body.availability).toBe(
      'OUT_OF_STOCK',
    );
    await pool.query(
      `UPDATE inventory_reservations SET expires_at = now() - interval '1 second', created_at = now() - interval '1 hour'`,
    );
    expect((await g.post('/v1/cart/items').send({ variantId: v.id })).status).toBe(201);
    expect((await request(app.getHttpServer()).get('/v1/products/held')).body.availability).toBe(
      'LOW_STOCK',
    );
  });
});

describe('signed-in customers', () => {
  it('orders with the account email and a saved address; cannot use someone elses address', async () => {
    const v = await variant({ stock: 5 });
    const { session } = await register(app, 'owner@example.com');
    const other = (await register(app, 'other@example.com')).session!;
    const api = as(app, session!);
    const addr = (await api.post('/v1/me/addresses').send(address)).body.items[0];
    const foreign = (await as(app, other).post('/v1/me/addresses').send(address)).body.items[0];
    await api.post('/v1/cart/items').send({ variantId: v.id, quantity: 1 });

    const place = (b: object) =>
      api
        .post('/v1/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ paymentMethod: 'COD', expectedTotalVnd: 130_000, ...b });
    expect((await place({ addressId: foreign.id })).status).toBe(404);
    expect(await count('orders')).toBe(0);
    const ok = await place({ addressId: addr.id, contactEmail: 'ignored@evil.example' });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ isOwner: true, customerEmail: 'owner@example.com' });
    expect(ok.body.shippingAddress.phone).toBe('0901234567');
    expect(
      (await pool.query('SELECT customer_email, user_id FROM orders')).rows[0].customer_email,
    ).toBe('owner@example.com');

    const list = await api.get('/v1/me/orders');
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({
      code: ok.body.code,
      status: 'CONFIRMED',
      totalVnd: 130_000,
      itemCount: 1,
    });
    expect((await as(app, other).get('/v1/me/orders')).body.items).toEqual([]);
    expect((await request(app.getHttpServer()).get('/v1/me/orders')).status).toBe(401);
  });

  it('requires CSRF for signed-in order placement', async () => {
    const v = await variant();
    const { session } = await register(app, 'csrf@example.com');
    await as(app, session!).post('/v1/cart/items').send({ variantId: v.id });
    const res = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Cookie', session!.cookie)
      .set('Origin', WEB_ORIGIN)
      .set('Idempotency-Key', randomUUID())
      .send(body(130_000));
    expect(res.status).toBe(403);
    expect(await count('orders')).toBe(0);
  });

  it('cancels their own CONFIRMED order once, returns the stock, and notifies', async () => {
    const v = await variant({ stock: 5 });
    const { session } = await register(app, 'c@example.com');
    const api = as(app, session!);
    await api.post('/v1/cart/items').send({ variantId: v.id, quantity: 2 });
    const order = (
      await api.post('/v1/orders').set('Idempotency-Key', randomUUID()).send(body(230_000))
    ).body;
    expect(await ledger(v.id)).toBe(3);
    expect(order.canCancel).toBe(true);
    const cancelled = await api.post(`/v1/orders/${order.code}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({
      status: 'CANCELLED',
      paymentStatus: 'CANCELLED',
      canCancel: false,
    });
    expect(await ledger(v.id)).toBe(5);
    expect(
      (
        await pool.query(`SELECT delta, reason FROM inventory_movements ORDER BY created_at, id`)
      ).rows.map((r) => r.reason),
    ).toEqual(['RECEIPT', 'SALE', 'RELEASE']);
    expect((await pool.query(`SELECT status FROM inventory_reservations`)).rows[0].status).toBe(
      'RELEASED',
    );
    expect((await api.post(`/v1/orders/${order.code}/cancel`)).status).toBe(409);
    expect(await ledger(v.id)).toBe(5); // not released twice
    expect(
      (
        await pool.query(
          `SELECT type FROM outbox_events WHERE type LIKE 'order.%' ORDER BY created_at`,
        )
      ).rows.map((r) => r.type),
    ).toEqual(['order.placed', 'order.status_changed']);
  });

  it("cannot cancel someone else's order, a guest order, or an order the shop already started", async () => {
    const v = await variant({ stock: 9 });
    const { session: a } = await register(app, 'a@example.com');
    const { session: b } = await register(app, 'b@example.com');
    await as(app, a!).post('/v1/cart/items').send({ variantId: v.id });
    const order = (
      await as(app, a!).post('/v1/orders').set('Idempotency-Key', randomUUID()).send(body(130_000))
    ).body;
    expect((await as(app, b!).post(`/v1/orders/${order.code}/cancel`)).status).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .post(`/v1/orders/${order.code}/cancel`)
          .set('Origin', WEB_ORIGIN)
      ).status,
    ).toBe(401);
    await pool.query(`UPDATE orders SET status = 'PROCESSING'`);
    const late = await as(app, a!).post(`/v1/orders/${order.code}/cancel`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('INVALID_STATE_TRANSITION');
    expect(await ledger(v.id)).toBe(8);
  });
});

describe('GET /v1/orders/:code', () => {
  it('shows the owner everything but masks contact details for link-only viewers', async () => {
    const v = await variant();
    const { session } = await register(app, 'masked@example.com');
    const api = as(app, session!);
    await api.post('/v1/cart/items').send({ variantId: v.id });
    const code = (
      await api.post('/v1/orders').set('Idempotency-Key', randomUUID()).send(body(130_000))
    ).body.code;
    const owner = orderSchema.parse((await api.get(`/v1/orders/${code}`)).body);
    expect(owner).toMatchObject({ isOwner: true, customerEmail: 'masked@example.com' });
    expect(owner.shippingAddress.line1).toBe('12 Lê Lợi');
    const viewer = orderSchema.parse(
      (await request(app.getHttpServer()).get(`/v1/orders/${code.toLowerCase()}`)).body,
    );
    expect(viewer.isOwner).toBe(false);
    expect(viewer.customerEmail).toBe('m•••••@example.com');
    expect(viewer.shippingAddress.phone).toBe('•••••••567');
    expect(viewer.shippingAddress.line1).not.toContain('Lê Lợi');
    expect(JSON.stringify(viewer)).not.toContain('masked@example.com');
  });

  it('returns 404 for malformed or unknown codes and rate-limits lookups', async () => {
    for (const code of ['nope', "'; DROP TABLE orders;--", 'AAAAAAAAAAAA']) {
      expect(
        (await request(app.getHttpServer()).get(`/v1/orders/${encodeURIComponent(code)}`)).status,
      ).toBe(404);
    }
    let last = 0;
    for (let i = 0; i < 65; i++)
      last = (await request(app.getHttpServer()).get('/v1/orders/AAAAAAAAAAAA')).status;
    expect(last).toBe(429);
  });
});

describe('admin order fulfilment', () => {
  async function placed(email = 'buyer@example.com') {
    const v = await variant({ stock: 10, slug: `p-${randomUUID().slice(0, 6)}` });
    const g = await guestWithCart([[v, 2]]);
    const order = (await place(g, body(230_000, { contactEmail: email }))).body;
    const id = (await pool.query('SELECT id FROM orders WHERE public_code = $1', [order.code]))
      .rows[0].id as string;
    return { v, id, code: order.code as string };
  }
  const staff = async (role: 'ADMIN' | 'FULFILLMENT' | 'SUPPORT' | 'CATALOG' | 'FINANCE') =>
    as(app, await login(app, (await createUser(pool, role)).email));
  const move = (
    api: ReturnType<typeof as>,
    id: string,
    version: number,
    to: string,
    extra: object = {},
  ) => api.patch(`/v1/admin/orders/${id}/status`).send({ to, version, ...extra });

  it('walks the full COD path with validated transitions, shipment, payment collection and history', async () => {
    const { id, code } = await placed();
    const api = await staff('FULFILLMENT');
    let d = adminOrderDetailSchema.parse((await api.get(`/v1/admin/orders/${id}`)).body);
    expect(d).toMatchObject({
      status: 'CONFIRMED',
      version: 1,
      allowedTransitions: ['PROCESSING', 'CANCELLED'],
    });
    expect(d.shippingAddress.phone).toBe('0901234567'); // staff see unmasked data

    d = adminOrderDetailSchema.parse((await move(api, id, 1, 'PROCESSING')).body);
    d = adminOrderDetailSchema.parse((await move(api, id, 2, 'READY_TO_SHIP')).body);
    const noCarrier = await move(api, id, 3, 'SHIPPING');
    expect(noCarrier.status).toBe(400);
    d = adminOrderDetailSchema.parse(
      (await move(api, id, 3, 'SHIPPING', { shipment: { carrier: 'GHN', trackingCode: 'GHN123' } }))
        .body,
    );
    expect(d.shipment).toMatchObject({ carrier: 'GHN', trackingCode: 'GHN123', status: 'SHIPPED' });
    d = adminOrderDetailSchema.parse((await move(api, id, 4, 'COMPLETED')).body);
    expect(d).toMatchObject({ status: 'COMPLETED', paymentStatus: 'PAID', allowedTransitions: [] });
    expect(d.shipment!.status).toBe('DELIVERED');
    expect(d.history.map((h) => h.status)).toEqual([
      'CONFIRMED',
      'PROCESSING',
      'READY_TO_SHIP',
      'SHIPPING',
      'COMPLETED',
    ]);
    expect(d.history[1]).toMatchObject({ from: 'CONFIRMED', actorType: 'ADMIN' });
    expect(d.history[1]!.actorEmail).toMatch(/@nona\.test$/);
    const public_ = orderSchema.parse(
      (await request(app.getHttpServer()).get(`/v1/orders/${code}`)).body,
    );
    expect(public_.status).toBe('COMPLETED');
    const events = (
      await pool.query(
        `SELECT payload->>'status' s FROM outbox_events WHERE type = 'order.status_changed' ORDER BY created_at`,
      )
    ).rows.map((r) => r.s);
    expect(events).toEqual(['SHIPPING', 'COMPLETED']);
    expect(
      (await pool.query(`SELECT action FROM audit_logs WHERE action = 'order.status_change'`))
        .rowCount,
    ).toBe(4);
  });

  it('refuses skipped, backward and post-terminal moves, and changes nothing', async () => {
    const { id } = await placed();
    const api = await staff('ADMIN');
    for (const to of ['SHIPPING', 'COMPLETED', 'READY_TO_SHIP', 'REFUNDED', 'CONFIRMED']) {
      const res = await move(api, id, 1, to);
      expect(res.status, to).toBe(409);
      expect(res.body.error.code).toBe('INVALID_STATE_TRANSITION');
    }
    expect(
      (await pool.query('SELECT status, version FROM orders WHERE id = $1', [id])).rows[0],
    ).toEqual({ status: 'CONFIRMED', version: 1 });
    await move(api, id, 1, 'CANCELLED', { reason: 'Khách đổi ý' });
    expect((await move(api, id, 2, 'PROCESSING')).status).toBe(409);
    expect((await move(api, id, 2, 'CANCELLED', { reason: 'again' })).status).toBe(409);
  });

  it('rejects stale versions so two staff cannot overwrite each other', async () => {
    const { id } = await placed();
    const api = await staff('ADMIN');
    expect((await move(api, id, 1, 'PROCESSING')).status).toBe(200);
    const stale = await move(api, id, 1, 'CANCELLED', { reason: 'late' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details).toMatchObject({
      currentVersion: 2,
      currentStatus: 'PROCESSING',
    });
  });

  it('cancels with a mandatory reason, returns stock exactly once, and records who did it', async () => {
    const { id, v } = await placed();
    expect(await ledger(v.id)).toBe(8);
    const api = await staff('ADMIN');
    expect((await move(api, id, 1, 'CANCELLED')).status).toBe(400);
    const res = await move(api, id, 1, 'CANCELLED', { reason: 'Hết nguyên liệu' });
    expect(res.status).toBe(200);
    expect(await ledger(v.id)).toBe(10);
    expect(res.body.history.at(-1)).toMatchObject({
      status: 'CANCELLED',
      reason: 'Hết nguyên liệu',
      actorType: 'ADMIN',
    });
    expect((await move(api, id, 2, 'CANCELLED', { reason: 'x' })).status).toBe(409);
    expect(await ledger(v.id)).toBe(10);
  });

  it('cannot cancel once the parcel is on its way', async () => {
    const { id, v } = await placed();
    const api = await staff('ADMIN');
    await move(api, id, 1, 'PROCESSING');
    await move(api, id, 2, 'READY_TO_SHIP');
    await move(api, id, 3, 'SHIPPING', { shipment: { carrier: 'GHTK' } });
    expect((await move(api, id, 4, 'CANCELLED', { reason: 'x' })).status).toBe(409);
    expect(await ledger(v.id)).toBe(8);
  });

  it('enforces permissions: read-only roles cannot change orders; others cannot even read', async () => {
    const { id } = await placed();
    for (const role of ['SUPPORT', 'FINANCE'] as const) {
      const api = await staff(role);
      expect((await api.get(`/v1/admin/orders/${id}`)).status, role).toBe(200);
      expect((await move(api, id, 1, 'PROCESSING')).status, role).toBe(403);
    }
    const catalog = await staff('CATALOG');
    expect((await catalog.get('/v1/admin/orders')).status).toBe(403);
    expect((await move(catalog, id, 1, 'PROCESSING')).status).toBe(403);
    const customer = (await register(app, 'cust@example.com')).session!;
    expect((await as(app, customer).get('/v1/admin/orders')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/v1/admin/orders')).status).toBe(401);
    expect((await pool.query('SELECT status FROM orders WHERE id = $1', [id])).rows[0].status).toBe(
      'CONFIRMED',
    );
  });

  it('lists and filters orders by status and by code/email/phone/name', async () => {
    const a = await placed('anna@example.com');
    await placed('bob@example.com');
    const api = await staff('SUPPORT');
    await pool.query(`UPDATE orders SET status = 'PROCESSING' WHERE id = $1`, [a.id]);
    const all = (await api.get('/v1/admin/orders')).body;
    expect(all.meta.total).toBe(2);
    expect(
      (await api.get('/v1/admin/orders?status=PROCESSING')).body.items.map(
        (o: { code: string }) => o.code,
      ),
    ).toEqual([a.code]);
    expect((await api.get('/v1/admin/orders?q=anna')).body.items).toHaveLength(1);
    expect((await api.get(`/v1/admin/orders?q=${a.code.slice(0, 6)}`)).body.items[0].code).toBe(
      a.code,
    );
    expect((await api.get('/v1/admin/orders?q=0901234')).body.items).toHaveLength(2);
    expect((await api.get('/v1/admin/orders?q=nguyen van')).body.items).toHaveLength(2);
    expect((await api.get('/v1/admin/orders?q=%25')).body.items).toHaveLength(0);
    expect((await api.get('/v1/admin/orders?status=BOGUS')).status).toBe(400);
  });
});

describe('database invariants', () => {
  it('rejects inconsistent totals and mutation of the status history', async () => {
    const v = await variant({ stock: 5 });
    const g = await guestWithCart([[v, 1]]);
    const code = (await place(g, body(130_000))).body.code;
    await expect(
      pool.query(`UPDATE orders SET total_vnd = 1 WHERE public_code = $1`, [code]),
    ).rejects.toThrow(/orders_total_consistent/);
    await expect(
      pool.query('UPDATE order_status_history SET to_status = $1', ['COMPLETED']),
    ).rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM order_status_history')).rejects.toThrow(/append-only/);
    await expect(
      pool.query('DELETE FROM product_variants WHERE id = $1', [v.id]),
    ).rejects.toThrow(); // referenced by order items
    expect(cookieFrom).toBeDefined();
  });
});

void (null as unknown as Session);
