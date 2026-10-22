import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminOrderDetailSchema, orderSchema } from '@nona/contracts';
import { signCallback } from '@nona/payments';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addStock, createCategory, createProduct } from './factories';
import {
  as,
  bootApp,
  createUser,
  guest,
  INTERNAL_TOKEN,
  login,
  resetAll,
  WEB_ORIGIN,
} from './helpers';

const SECRET = 'nona-simulator-secret-dev-only';
const TMN = 'NONASIM1';
let app: NestExpressApplication;
let pool: pg.Pool;
let cat: string;
beforeAll(async () => ({ app, pool } = await bootApp({ listen: true })));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  cat = await createCategory(pool);
  await request(app.getHttpServer())
    .post('/v1/dev/vnpay/control')
    .send({ query: 'ok', refund: 'ok' });
});

const address = {
  fullName: 'Nguyễn Văn A',
  phone: '0901234567',
  line1: '12 Lê Lợi',
  ward: 'Bến Thành',
  district: 'Quận 1',
  province: 'TP. Hồ Chí Minh',
};
const variant = async (o: { price?: number; stock?: number; slug?: string } = {}) => {
  const r = await createProduct(pool, {
    categoryId: cat,
    slug: o.slug,
    variants: [{ price: o.price ?? 100_000, stock: o.stock ?? 10 }],
  });
  return { id: r.variantIds[0]!, productId: r.productId };
};
const ledger = async (v: string) =>
  Number(
    (
      await pool.query(
        'SELECT COALESCE(SUM(delta),0) s FROM inventory_movements WHERE variant_id=$1',
        [v],
      )
    ).rows[0].s,
  );
const available = async (slug: string) =>
  (await request(app.getHttpServer()).get(`/v1/products/${slug}`)).body.availability as string;
const count = async (sql: string) => Number((await pool.query(sql)).rows[0].n);

async function onlineOrder(
  items: [{ id: string }, number][] = [],
  extra: { key?: string; total?: number; coupon?: string } = {},
) {
  const g = guest(app);
  for (const [v, q] of items) await g.post('/v1/cart/items').send({ variantId: v.id, quantity: q });
  if (extra.coupon) await g.post('/v1/cart/coupon').send({ code: extra.coupon });
  const quote = (await g.post('/v1/checkout/quote').send({ province: address.province })).body;
  const res = await g
    .post('/v1/orders')
    .set('Idempotency-Key', extra.key ?? randomUUID())
    .send({
      shippingAddress: address,
      contactEmail: 'buyer@example.com',
      paymentMethod: 'VNPAY',
      expectedTotalVnd: extra.total ?? quote.totalVnd,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = orderSchema.parse(res.body);
  const params = Object.fromEntries(new URL(order.paymentUrl!).searchParams);
  return {
    g,
    order,
    code: order.code,
    paymentUrl: order.paymentUrl!,
    txnRef: params.vnp_TxnRef!,
    amountVnd: order.totalVnd,
  };
}

const makeIpn = (
  txnRef: string,
  amountVnd: number,
  o: {
    success?: boolean;
    transactionNo?: string;
    tmn?: string;
    extra?: Record<string, string>;
  } = {},
) =>
  signCallback(
    { hashSecret: SECRET },
    {
      vnp_TmnCode: o.tmn ?? TMN,
      vnp_Amount: amountVnd * 100,
      vnp_BankCode: 'NCB',
      vnp_OrderInfo: 'x',
      vnp_PayDate: '20261010153200',
      vnp_ResponseCode: o.success === false ? '24' : '00',
      vnp_TransactionNo: o.transactionNo ?? '14000001',
      vnp_TransactionStatus: o.success === false ? '02' : '00',
      vnp_TxnRef: txnRef,
      ...(o.extra ?? {}),
    },
  );
const ipn = (params: Record<string, string>) =>
  request(app.getHttpServer()).get('/v1/webhooks/payments/vnpay').query(params);
const orderState = async (code: string) =>
  (await pool.query('SELECT status FROM orders WHERE public_code = $1', [code])).rows[0]
    .status as string;
const history = async (code: string) =>
  (
    await pool.query(
      `SELECT to_status FROM order_status_history h JOIN orders o ON o.id = h.order_id WHERE o.public_code = $1 ORDER BY h.seq`,
      [code],
    )
  ).rows.map((r) => r.to_status);

/** Drives the simulated payment page exactly like a browser would. */
async function simPay(paymentUrl: string, outcome: 'SUCCESS' | 'FAILED', deliverIpn = true) {
  const params = Object.fromEntries(new URL(paymentUrl).searchParams);
  const tx = await request(app.getHttpServer()).get('/v1/dev/vnpay/transaction').query(params);
  expect(tx.status).toBe(200);
  return request(app.getHttpServer())
    .post('/v1/dev/vnpay/decide')
    .send({ txnRef: params.vnp_TxnRef, outcome, deliverIpn });
}
const jobs = () =>
  request(app.getHttpServer())
    .post('/v1/internal/jobs/payments-maintenance')
    .set('x-internal-token', INTERNAL_TOKEN);
const ageOrder = async (code: string) => {
  await pool.query(
    `UPDATE payments SET created_at = now() - interval '10 minutes' WHERE order_id = (SELECT id FROM orders WHERE public_code = $1)`,
    [code],
  );
};
const expireNow = (code: string) =>
  pool.query(
    `UPDATE orders SET payment_expires_at = now() - interval '5 minutes' WHERE public_code = $1`,
    [code],
  );

describe('placing an online-payment order', () => {
  it('holds the stock, sells nothing, and waits for a verified payment', async () => {
    const v = await variant({ price: 100_000, stock: 3 });
    const { order, code } = await onlineOrder([[v, 2]]);
    expect(order).toMatchObject({
      status: 'PENDING_PAYMENT',
      paymentMethod: 'VNPAY',
      paymentStatus: 'PENDING',
      totalVnd: 230_000,
    });
    expect(order.paymentUrl).toMatch(/^http:\/\/localhost:3100\/dev\/vnpay\?/);
    expect(new Date(order.paymentExpiresAt!).getTime()).toBeGreaterThan(Date.now() + 25 * 60_000);
    expect(await ledger(v.id)).toBe(3); // nothing sold yet
    expect((await pool.query(`SELECT status, quantity FROM inventory_reservations`)).rows).toEqual([
      { status: 'ACTIVE', quantity: 2 },
    ]);
    expect(await count(`SELECT COUNT(*) n FROM outbox_events`)).toBe(0); // no confirmation email before payment
    expect(await history(code)).toEqual(['PENDING_PAYMENT']);
  });

  it('reduces availability while held, so a second buyer cannot take the held units', async () => {
    const v = await variant({ stock: 2, slug: 'held-item' });
    await onlineOrder([[v, 2]]);
    expect(await available('held-item')).toBe('OUT_OF_STOCK');
    const other = guest(app);
    expect((await other.post('/v1/cart/items').send({ variantId: v.id })).status).toBe(409);
  });

  it('uses the admin-configured payment window', async () => {
    await pool.query(
      `UPDATE site_settings SET value = '{"paymentWindowMinutes": 10, "requirePhoneVerification": false}' WHERE key = 'checkout'`,
    );
    const v = await variant();
    const { order } = await onlineOrder([[v, 1]]);
    const minutes = (new Date(order.paymentExpiresAt!).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(8);
    expect(minutes).toBeLessThanOrEqual(10);
  });

  it('is idempotent: one order and one payment attempt for the same key', async () => {
    const v = await variant();
    const key = randomUUID();
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId: v.id });
    const body = {
      shippingAddress: address,
      contactEmail: 'a@example.com',
      paymentMethod: 'VNPAY',
      expectedTotalVnd: 130_000,
    };
    const a = await g.post('/v1/orders').set('Idempotency-Key', key).send(body);
    const b = await g.post('/v1/orders').set('Idempotency-Key', key).send(body);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.code).toBe(a.body.code);
    expect(b.body.paymentUrl).toBe(a.body.paymentUrl);
    expect(await count('SELECT COUNT(*) n FROM orders')).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM payments')).toBe(1);
  });
});

describe('IPN webhook (verified, idempotent)', () => {
  it('confirms the order from a signed success callback: sells stock, PAID then CONFIRMED, emails once', async () => {
    const v = await variant({ stock: 5 });
    const { code, txnRef, amountVnd } = await onlineOrder([[v, 2]]);
    const res = await ipn(makeIpn(txnRef, amountVnd));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ RspCode: '00', Message: 'Confirm Success' });
    expect(await orderState(code)).toBe('CONFIRMED');
    expect(await history(code)).toEqual(['PENDING_PAYMENT', 'PAID', 'CONFIRMED']);
    expect(await ledger(v.id)).toBe(3);
    expect((await pool.query(`SELECT status FROM inventory_reservations`)).rows[0].status).toBe(
      'CONSUMED',
    );
    const pay = (await pool.query('SELECT status, provider_transaction_no, paid_at FROM payments'))
      .rows[0];
    expect(pay).toMatchObject({ status: 'PAID', provider_transaction_no: '14000001' });
    expect(pay.paid_at).not.toBeNull();
    const events = (await pool.query(`SELECT type, payload FROM outbox_events`)).rows;
    expect(events.map((e) => e.type)).toEqual(['order.placed']);
    expect(events[0].payload).toMatchObject({
      orderCode: code,
      email: 'buyer@example.com',
      paymentMethod: 'VNPAY',
      totalVnd: amountVnd,
    });
  });

  it('acknowledges duplicate deliveries without any second effect', async () => {
    const v = await variant({ stock: 5 });
    const { txnRef, amountVnd } = await onlineOrder([[v, 1]]);
    const params = makeIpn(txnRef, amountVnd);
    expect((await ipn(params)).body.RspCode).toBe('00');
    for (let i = 0; i < 3; i++)
      expect((await ipn(params)).body).toEqual({
        RspCode: '02',
        Message: 'Order already confirmed',
      });
    // concurrent duplicates as well
    const burst = await Promise.all(Array.from({ length: 5 }, () => ipn(params)));
    expect(burst.every((r) => r.status === 200 && r.body.RspCode === '02')).toBe(true);
    expect(await ledger(v.id)).toBe(4); // sold exactly once
    expect(await count(`SELECT COUNT(*) n FROM inventory_movements WHERE reason = 'SALE'`)).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM outbox_events')).toBe(1);
    expect(await count('SELECT COUNT(*) n FROM refunds')).toBe(0);
  });

  it('survives a burst of the very first delivery too (same event racing itself)', async () => {
    const v = await variant({ stock: 5 });
    const { code, txnRef, amountVnd } = await onlineOrder([[v, 1]]);
    const params = makeIpn(txnRef, amountVnd);
    const results = await Promise.all(Array.from({ length: 6 }, () => ipn(params)));
    expect(results.filter((r) => r.body.RspCode === '00')).toHaveLength(1);
    expect(results.filter((r) => r.body.RspCode === '02')).toHaveLength(5);
    expect(await ledger(v.id)).toBe(4);
    expect(await history(code)).toEqual(['PENDING_PAYMENT', 'PAID', 'CONFIRMED']);
  });

  it('rejects bad signatures, forged amounts, wrong merchant and unknown references without changing anything', async () => {
    const v = await variant({ stock: 5 });
    const { code, txnRef, amountVnd } = await onlineOrder([[v, 1]]);
    const good = makeIpn(txnRef, amountVnd);
    expect((await ipn({ ...good, vnp_Amount: '100' })).body.RspCode).toBe('97'); // tampered after signing
    expect((await ipn({ ...good, vnp_SecureHash: 'a'.repeat(128) })).body.RspCode).toBe('97');
    const { vnp_SecureHash: _drop, ...unsigned } = good;
    expect((await ipn(unsigned)).body.RspCode).toBe('97');
    expect((await ipn(makeIpn(txnRef, 1))).body.RspCode).toBe('04'); // correctly signed, wrong amount (1đ)
    expect((await ipn(makeIpn(txnRef, amountVnd, { tmn: 'OTHERMERCHANT' }))).body.RspCode).toBe(
      '99',
    );
    expect((await ipn(makeIpn('ZZZZZZZZZZZZ01', amountVnd))).body.RspCode).toBe('01');
    expect(await orderState(code)).toBe('PENDING_PAYMENT');
    expect(await ledger(v.id)).toBe(5);
    expect((await pool.query('SELECT status FROM payments')).rows[0].status).toBe('PENDING');
    expect(await count(`SELECT COUNT(*) n FROM payment_events WHERE outcome = 'SUCCESS'`)).toBe(0);
  });

  it('keeps the order payable after a failed attempt and accepts a later successful one', async () => {
    const v = await variant({ stock: 5 });
    const { g, code, txnRef, amountVnd } = await onlineOrder([[v, 1]]);
    expect((await ipn(makeIpn(txnRef, amountVnd, { success: false }))).body.RspCode).toBe('00');
    expect(await orderState(code)).toBe('PENDING_PAYMENT'); // still holds the stock, customer may retry
    expect((await pool.query('SELECT status FROM payments')).rows[0].status).toBe('FAILED');
    expect(await ledger(v.id)).toBe(5);

    const retry = await g
      .post('/v1/payments/vnpay')
      .set('Idempotency-Key', randomUUID())
      .send({ orderCode: code });
    expect(retry.status).toBe(200);
    const txn2 = new URL(retry.body.paymentUrl).searchParams.get('vnp_TxnRef')!;
    expect(txn2).toBe(`${code}02`);
    expect((await ipn(makeIpn(txn2, amountVnd, { transactionNo: '14000002' }))).body.RspCode).toBe(
      '00',
    );
    expect(await orderState(code)).toBe('CONFIRMED');
  });

  it('accepts POST callbacks too and ignores non-string/array parameter tricks', async () => {
    const v = await variant({ stock: 5 });
    const { txnRef, amountVnd, code } = await onlineOrder([[v, 1]]);
    const params = makeIpn(txnRef, amountVnd);
    const arrayTrick = await request(app.getHttpServer())
      .get('/v1/webhooks/payments/vnpay')
      .query({ ...params, vnp_ResponseCode: ['00', '24'] });
    expect(arrayTrick.body.RspCode).toBe('97');
    const post = await request(app.getHttpServer())
      .post('/v1/webhooks/payments/vnpay')
      .type('form')
      .send(params);
    expect(post.status).toBe(200);
    expect(post.body.RspCode).toBe('00');
    expect(await orderState(code)).toBe('CONFIRMED');
  });

  it('never confirms from the browser redirect alone: the order page only reflects verified state', async () => {
    const v = await variant({ stock: 5 });
    const { code, paymentUrl } = await onlineOrder([[v, 1]]);
    // The shopper "returns" from the gateway; no callback was verified. Nothing may change.
    await request(app.getHttpServer())
      .get('/v1/dev/vnpay/transaction')
      .query(Object.fromEntries(new URL(paymentUrl).searchParams));
    const page = orderSchema.parse(
      (await request(app.getHttpServer()).get(`/v1/orders/${code}`)).body,
    );
    expect(page.status).toBe('PENDING_PAYMENT');
    expect(page.paymentStatus).toBe('PENDING');
  });
});

describe('payment initiation', () => {
  it('requires an Idempotency-Key, replays it, and refuses non-payable orders', async () => {
    const v = await variant({ stock: 5 });
    const { g, code } = await onlineOrder([[v, 1]]);
    expect((await g.post('/v1/payments/vnpay').send({ orderCode: code })).body.error.code).toBe(
      'IDEMPOTENCY_KEY_REQUIRED',
    );
    const key = randomUUID();
    const a = await g
      .post('/v1/payments/vnpay')
      .set('Idempotency-Key', key)
      .send({ orderCode: code });
    const b = await g
      .post('/v1/payments/vnpay')
      .set('Idempotency-Key', key)
      .send({ orderCode: code });
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.paymentUrl).toBe(a.body.paymentUrl);
    expect(await count('SELECT COUNT(*) n FROM payments')).toBe(2); // original + one retry attempt
    expect(
      (
        await g
          .post('/v1/payments/vnpay')
          .set('Idempotency-Key', randomUUID())
          .send({ orderCode: 'AAAAAAAAAAAA' })
      ).status,
    ).toBe(404);
    expect(
      (
        await g
          .post('/v1/payments/vnpay')
          .set('Idempotency-Key', randomUUID())
          .send({ orderCode: 'bad' })
      ).status,
    ).toBe(400);
    await expireNow(code);
    const late = await g
      .post('/v1/payments/vnpay')
      .set('Idempotency-Key', randomUUID())
      .send({ orderCode: code });
    expect(late.status).toBe(409);
  });

  it('refuses COD orders and already-paid orders', async () => {
    const v = await variant({ stock: 9 });
    const cod = guest(app);
    await cod.post('/v1/cart/items').send({ variantId: v.id });
    const placed = await cod.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: address,
      contactEmail: 'c@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: 130_000,
    });
    expect(
      (
        await cod
          .post('/v1/payments/vnpay')
          .set('Idempotency-Key', randomUUID())
          .send({ orderCode: placed.body.code })
      ).status,
    ).toBe(409);
    const online = await onlineOrder([[v, 1]]);
    await ipn(makeIpn(online.txnRef, online.amountVnd));
    expect(
      (
        await online.g
          .post('/v1/payments/vnpay')
          .set('Idempotency-Key', randomUUID())
          .send({ orderCode: online.code })
      ).status,
    ).toBe(409);
  });
});

describe('expiry, late payments and duplicates', () => {
  it('expires an unpaid order after the window, freeing the stock and the coupon use', async () => {
    const v = await variant({ stock: 2, slug: 'expiring' });
    const { code } = await onlineOrder([[v, 2]]);
    expect(await available('expiring')).toBe('OUT_OF_STOCK');
    expect((await jobs()).body.expired).toBe(0); // not yet due
    await expireNow(code);
    const res = await jobs();
    expect(res.status).toBe(200);
    expect(res.body.expired).toBe(1);
    expect(await orderState(code)).toBe('EXPIRED');
    expect(await history(code)).toEqual(['PENDING_PAYMENT', 'EXPIRED']);
    expect(await available('expiring')).toBe('LOW_STOCK');
    expect((await pool.query('SELECT status FROM inventory_reservations')).rows[0].status).toBe(
      'EXPIRED',
    );
    expect((await pool.query('SELECT status FROM payments')).rows[0].status).toBe('CANCELLED');
    expect((await jobs()).body.expired).toBe(0); // idempotent
  });

  it('accepts a late payment for an expired order when the stock is still there (order revived)', async () => {
    const v = await variant({ stock: 3 });
    const { code, txnRef, amountVnd } = await onlineOrder([[v, 1]]);
    await expireNow(code);
    await jobs();
    expect(await orderState(code)).toBe('EXPIRED');
    expect((await ipn(makeIpn(txnRef, amountVnd))).body.RspCode).toBe('00');
    expect(await orderState(code)).toBe('CONFIRMED');
    expect(await ledger(v.id)).toBe(2);
    expect(await count('SELECT COUNT(*) n FROM refunds')).toBe(0);
  });

  it('refunds a late payment automatically when the stock has meanwhile been sold to someone else', async () => {
    const v = await variant({ stock: 1, slug: 'last-one' });
    const first = await onlineOrder([[v, 1]]);
    await simPay(first.paymentUrl, 'SUCCESS', false).then(() => undefined); // register the txn at the simulator, no IPN yet
    await expireNow(first.code);
    await jobs(); // first order expires, releasing the unit
    const buyer = guest(app);
    await buyer.post('/v1/cart/items').send({ variantId: v.id });
    const bought = await buyer.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: address,
      contactEmail: 'b@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: 130_000,
    });
    expect(bought.status).toBe(201); // someone else got the last unit
    // ... and now the first shopper's money arrives
    const late = await ipn(makeIpn(first.txnRef, first.amountVnd, { transactionNo: '14000009' }));
    expect(late.body.RspCode).toBe('00');
    expect(await history(first.code)).toEqual([
      'PENDING_PAYMENT',
      'EXPIRED',
      'REFUND_PENDING',
      'REFUNDED',
    ]);
    expect((await pool.query('SELECT status, reason FROM refunds')).rows[0]).toMatchObject({
      status: 'SUCCEEDED',
    });
    expect(await ledger(v.id)).toBe(0); // the unit stays with the second buyer: never oversold
  });

  it('refunds money that arrives for an order the customer already cancelled', async () => {
    const v = await variant({ stock: 3 });
    const customer = await (async () => {
      const email = 'owner@example.com';
      const u = await createUser(pool, 'CUSTOMER', { email });
      return as(app, await login(app, u.email));
    })();
    await customer.post('/v1/cart/items').send({ variantId: v.id });
    const placed = await customer
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: address, paymentMethod: 'VNPAY', expectedTotalVnd: 130_000 });
    const code = placed.body.code as string;
    const url = new URL(placed.body.paymentUrl);
    const cancelled = await customer.post(`/v1/orders/${code}/cancel`);
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(await ledger(v.id)).toBe(3); // the hold was released, nothing was ever sold
    await simPay(placed.body.paymentUrl, 'SUCCESS'); // the customer paid in another tab anyway
    expect(url.searchParams.get('vnp_TxnRef')).toBe(`${code}01`);
    expect(await orderState(code)).toBe('REFUNDED'); // refunded through the provider
    expect((await pool.query('SELECT status, amount_vnd FROM refunds')).rows).toEqual([
      { status: 'SUCCEEDED', amount_vnd: '130000' },
    ]);
    expect(
      (await pool.query("SELECT status, refunded_vnd FROM payments WHERE status <> 'CANCELLED'"))
        .rows[0],
    ).toMatchObject({ status: 'REFUNDED' });
    expect(await ledger(v.id)).toBe(3);
  });

  it('detects a duplicate payment (two attempts both paid) and refunds the second one', async () => {
    const v = await variant({ stock: 5 });
    const { g, code, paymentUrl } = await onlineOrder([[v, 1]]);
    const retry = await g
      .post('/v1/payments/vnpay')
      .set('Idempotency-Key', randomUUID())
      .send({ orderCode: code });
    expect((await simPay(paymentUrl, 'SUCCESS')).body.ack.RspCode).toBe('00');
    expect((await simPay(retry.body.paymentUrl, 'SUCCESS')).body.ack.RspCode).toBe('00');
    expect(await orderState(code)).toBe('CONFIRMED'); // order unaffected by the duplicate
    expect(await ledger(v.id)).toBe(4); // sold once
    const refunds = (await pool.query('SELECT status, reason, amount_vnd FROM refunds')).rows;
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ status: 'SUCCEEDED', amount_vnd: '130000' });
    expect(refunds[0].reason).toMatch(/trùng/);
    expect(await count(`SELECT COUNT(*) n FROM payments WHERE status = 'PAID'`)).toBe(1);
  });
});

describe('reconciliation (pull model)', () => {
  it('finds a payment whose webhook was lost and settles it exactly once', async () => {
    const v = await variant({ stock: 5 });
    const { code, paymentUrl } = await onlineOrder([[v, 1]]);
    const sim = await simPay(paymentUrl, 'SUCCESS', false); // provider took the money; IPN never arrived
    expect(sim.body.ack).toBeNull();
    expect(await orderState(code)).toBe('PENDING_PAYMENT');
    expect((await jobs()).body.reconcile.checked).toBe(0); // too recent to chase
    await ageOrder(code);
    const res = await jobs();
    expect(res.body.reconcile).toMatchObject({ checked: 1, settled: 1 });
    expect(await orderState(code)).toBe('CONFIRMED');
    expect(await history(code)).toEqual(['PENDING_PAYMENT', 'PAID', 'CONFIRMED']);
    expect(await ledger(v.id)).toBe(4);
    expect((await jobs()).body.reconcile.checked).toBe(0);
    expect(await count('SELECT COUNT(*) n FROM outbox_events')).toBe(1);
  });

  it('records a failed payment found by reconciliation, and leaves unknown results untouched', async () => {
    const v = await variant({ stock: 5 });
    const failed = await onlineOrder([[v, 1]]);
    await simPay(failed.paymentUrl, 'FAILED', false);
    await ageOrder(failed.code);
    expect((await jobs()).body.reconcile).toMatchObject({ failed: 1 });
    expect(
      (await pool.query(`SELECT status FROM payments WHERE provider_ref = $1`, [failed.txnRef]))
        .rows[0].status,
    ).toBe('FAILED');

    const unknown = await onlineOrder([[v, 1]]);
    await simPay(unknown.paymentUrl, 'SUCCESS', false);
    await ageOrder(unknown.code);
    await request(app.getHttpServer()).post('/v1/dev/vnpay/control').send({ query: 'error' });
    const res = await jobs();
    expect(res.body.reconcile).toMatchObject({ checked: 1, unknown: 1, settled: 0 });
    expect(await orderState(unknown.code)).toBe('PENDING_PAYMENT'); // never guessed as paid
    // once the provider is back, a later run settles it (after the per-payment back-off)
    await request(app.getHttpServer()).post('/v1/dev/vnpay/control').send({ query: 'ok' });
    await pool.query(`UPDATE payments SET metadata = '{}'::jsonb`);
    expect((await jobs()).body.reconcile).toMatchObject({ settled: 1 });
    expect(await orderState(unknown.code)).toBe('CONFIRMED');
  });

  it('rejects the maintenance endpoint without the internal token', async () => {
    expect(
      (await request(app.getHttpServer()).post('/v1/internal/jobs/payments-maintenance')).status,
    ).toBe(404);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/internal/jobs/payments-maintenance')
          .set('x-internal-token', 'wrong')
      ).status,
    ).toBe(404);
    expect((await request(app.getHttpServer()).get('/v1/internal/metrics')).status).toBe(404);
  });
});

describe('cancelling a paid online order refunds it', () => {
  async function paidOrderOfCustomer() {
    const v = await variant({ stock: 5 });
    const u = await createUser(pool, 'CUSTOMER', { email: 'paid@example.com' });
    const api = as(app, await login(app, u.email));
    await api.post('/v1/cart/items').send({ variantId: v.id, quantity: 2 });
    const placed = await api
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ shippingAddress: address, paymentMethod: 'VNPAY', expectedTotalVnd: 230_000 });
    await simPay(placed.body.paymentUrl, 'SUCCESS');
    return { v, api, code: placed.body.code as string };
  }

  it('lets the customer cancel while CONFIRMED: stock returns, refund goes through, order ends REFUNDED', async () => {
    const { v, api, code } = await paidOrderOfCustomer();
    expect(await ledger(v.id)).toBe(3);
    const res = await api.post(`/v1/orders/${code}/cancel`);
    expect(res.status).toBe(200);
    expect(await orderState(code)).toBe('REFUNDED');
    expect(await history(code)).toEqual([
      'PENDING_PAYMENT',
      'PAID',
      'CONFIRMED',
      'REFUND_PENDING',
      'REFUNDED',
    ]);
    expect(await ledger(v.id)).toBe(5);
    expect((await pool.query('SELECT status, amount_vnd FROM refunds')).rows).toEqual([
      { status: 'SUCCEEDED', amount_vnd: '230000' },
    ]);
    expect((await pool.query('SELECT status, refunded_vnd FROM payments')).rows[0]).toMatchObject({
      status: 'REFUNDED',
      refunded_vnd: '230000',
    });
    const emails = (
      await pool.query(
        `SELECT payload->>'status' s FROM outbox_events WHERE type = 'order.status_changed' ORDER BY created_at`,
      )
    ).rows.map((r) => r.s);
    expect(emails).toEqual(['REFUND_PENDING', 'REFUNDED']);
  });

  it('lets staff cancel before shipping, and never refunds more than was paid', async () => {
    const { api, code } = await paidOrderOfCustomer();
    void api;
    const admin = as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
    const id = (await pool.query('SELECT id FROM orders WHERE public_code = $1', [code])).rows[0]
      .id as string;
    const cancel = await admin
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'CANCELLED', version: 3, reason: 'Hết nguyên liệu' });
    expect(cancel.status, JSON.stringify(cancel.body)).toBe(200);
    expect(adminOrderDetailSchema.parse(cancel.body)).toMatchObject({
      status: 'REFUNDED',
      refundableVnd: 0,
    });
    expect(await count('SELECT COUNT(*) n FROM refunds')).toBe(1);
    expect(
      (
        await admin
          .post(`/v1/admin/orders/${id}/refunds`)
          .set('Idempotency-Key', randomUUID())
          .send({ amountVnd: 1000, reason: 'again' })
      ).status,
    ).toBe(409);
  });
});

describe('manual and partial refunds (finance)', () => {
  async function completedOnlineOrder() {
    const v = await variant({ stock: 5 });
    const { code, paymentUrl } = await onlineOrder([[v, 2]]);
    await simPay(paymentUrl, 'SUCCESS');
    const fulfil = as(app, await login(app, (await createUser(pool, 'FULFILLMENT')).email));
    const id = (await pool.query('SELECT id FROM orders WHERE public_code = $1', [code])).rows[0]
      .id as string;
    const step = async (to: string, version: number, extra: object = {}) =>
      fulfil.patch(`/v1/admin/orders/${id}/status`).send({ to, version, ...extra });
    // PAID -> CONFIRMED consumed versions: pending(1) -> PAID(2) -> CONFIRMED(3)
    await step('PROCESSING', 3);
    await step('READY_TO_SHIP', 4);
    await step('SHIPPING', 5, { shipment: { carrier: 'GHN' } });
    expect((await step('COMPLETED', 6)).status).toBe(200);
    const finance = as(app, await login(app, (await createUser(pool, 'FINANCE')).email));
    return { id, finance, fulfil, code };
  }
  const refund = (api: ReturnType<typeof as>, id: string, amountVnd: number, key = randomUUID()) =>
    api
      .post(`/v1/admin/orders/${id}/refunds`)
      .set('Idempotency-Key', key)
      .send({ amountVnd, reason: 'Khách trả 1 sản phẩm' });

  it('refunds in parts: PARTIALLY_REFUNDED, then REFUNDED when the full amount is returned', async () => {
    const { id, finance } = await completedOnlineOrder();
    const first = await refund(finance, id, 100_000);
    expect(first.status).toBe(201);
    expect(adminOrderDetailSchema.parse(first.body)).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedVnd: 100_000,
      refundableVnd: 130_000,
    });
    const second = await refund(finance, id, 130_000);
    expect(adminOrderDetailSchema.parse(second.body)).toMatchObject({
      status: 'REFUNDED',
      refundedVnd: 230_000,
      refundableVnd: 0,
    });
    expect(second.body.refunds.map((r: { status: string }) => r.status)).toEqual([
      'SUCCEEDED',
      'SUCCEEDED',
    ]);
    expect(
      (
        await pool.query(
          `SELECT action FROM audit_logs WHERE action LIKE 'refund.%' ORDER BY created_at`,
        )
      ).rows.map((r) => r.action),
    ).toEqual(['refund.request', 'refund.succeeded', 'refund.request', 'refund.succeeded']);
  });

  it('refuses amounts above what is refundable, and is idempotent per key', async () => {
    const { id, finance } = await completedOnlineOrder();
    const tooMuch = await refund(finance, id, 230_001);
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error.details.refundableVnd).toBe(230_000);
    const key = randomUUID();
    expect((await refund(finance, id, 50_000, key)).status).toBe(201);
    const replay = await refund(finance, id, 50_000, key);
    expect(replay.status).toBe(409); // same key cannot create a second refund
    expect(await count('SELECT COUNT(*) n FROM refunds')).toBe(1);
    expect((await refund(finance, id, 0)).status).toBe(400);
    expect(
      (await finance.post(`/v1/admin/orders/${id}/refunds`).send({ amountVnd: 5, reason: 'x' }))
        .body.error.code,
    ).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('is limited to staff with refunds:write, to online-paid orders in a refundable state', async () => {
    const { id, fulfil, finance, code } = await completedOnlineOrder();
    expect((await refund(fulfil, id, 1000)).status).toBe(403);
    expect(
      (await refund(as(app, await login(app, (await createUser(pool, 'SUPPORT')).email)), id, 1000))
        .status,
    ).toBe(403);
    // a CONFIRMED (not yet completed) order cannot be partially refunded
    const v = await variant({ stock: 5 });
    const open = await onlineOrder([[v, 1]]);
    await simPay(open.paymentUrl, 'SUCCESS');
    const openId = (await pool.query('SELECT id FROM orders WHERE public_code = $1', [open.code]))
      .rows[0].id as string;
    expect((await refund(finance, openId, 1000)).body.error.code).toBe('INVALID_STATE_TRANSITION');
    // COD order
    const cod = guest(app);
    await cod.post('/v1/cart/items').send({ variantId: v.id });
    const placed = await cod.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: address,
      contactEmail: 'c@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: 130_000,
    });
    const codId = (
      await pool.query('SELECT id FROM orders WHERE public_code = $1', [placed.body.code])
    ).rows[0].id as string;
    await pool.query(`UPDATE orders SET status = 'COMPLETED' WHERE id = $1`, [codId]);
    expect((await refund(finance, codId, 1000)).status).toBe(409);
    void code;
  });

  it('never auto-retries a refund whose outcome is unknown; finance resolves it manually', async () => {
    const { id, finance } = await completedOnlineOrder();
    await request(app.getHttpServer()).post('/v1/dev/vnpay/control').send({ refund: 'error' });
    const res = await refund(finance, id, 100_000);
    expect(res.status).toBe(201);
    const pending = adminOrderDetailSchema.parse(res.body);
    expect(pending.status).toBe('COMPLETED'); // nothing assumed
    expect(pending.refunds[0]).toMatchObject({ status: 'PENDING' });
    const row = (await pool.query('SELECT id, attempted_at FROM refunds')).rows[0];
    expect(row.attempted_at).not.toBeNull();
    await request(app.getHttpServer()).post('/v1/dev/vnpay/control').send({ refund: 'ok' });
    await pool
      .query(`UPDATE refunds SET created_at = now() - interval '1 hour'`)
      .catch(() => undefined);
    const run = await jobs();
    expect(run.body.refundsSent).toBe(0); // attempted refunds are never re-sent
    expect((await pool.query('SELECT status FROM refunds')).rows[0].status).toBe('PENDING');
    const status = (await finance.get('/v1/admin/system')).status;
    expect(status).toBe(403); // finance has no system:read
    const admin = as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
    const sys = (await admin.get('/v1/admin/system')).body;
    expect(sys.refunds.needsManual).toBe(0); // created_at update above is blocked by the append-only trigger
    const resolved = await finance
      .post(`/v1/admin/refunds/${row.id}/resolve`)
      .send({ outcome: 'SUCCEEDED', note: 'Đã đối chiếu trên cổng VNPay' });
    expect(resolved.status).toBe(200);
    expect(adminOrderDetailSchema.parse(resolved.body)).toMatchObject({
      status: 'PARTIALLY_REFUNDED',
      refundedVnd: 100_000,
    });
    expect(
      (
        await finance
          .post(`/v1/admin/refunds/${row.id}/resolve`)
          .send({ outcome: 'FAILED', note: 'again' })
      ).status,
    ).toBe(409);
    expect(
      (await pool.query(`SELECT action FROM audit_logs WHERE action = 'refund.resolve_manual'`))
        .rowCount,
    ).toBe(1);
  });

  it('keeps refund rows append-only at the database level', async () => {
    const { id, finance } = await completedOnlineOrder();
    await refund(finance, id, 100_000);
    await expect(pool.query('DELETE FROM refunds')).rejects.toThrow(/append-only/);
    await expect(pool.query('UPDATE refunds SET amount_vnd = 1')).rejects.toThrow(/append-only/);
    await expect(pool.query(`UPDATE refunds SET status = 'PENDING'`)).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query(`UPDATE refunds SET reason = 'edited'`)).rejects.toThrow(/append-only/);
  });
});

describe('operations visibility', () => {
  it('exposes metrics (token-protected) and a permissioned status page with alerts', async () => {
    const v = await variant({ stock: 5 });
    await onlineOrder([[v, 1]]);
    await pool.query(
      `INSERT INTO outbox_events (type, payload, status) VALUES ('order.placed', '{}', 'DEAD')`,
    );
    const m = await request(app.getHttpServer())
      .get('/v1/internal/metrics')
      .set('x-internal-token', INTERNAL_TOKEN);
    expect(m.status).toBe(200);
    expect(m.headers['content-type']).toMatch(/text\/plain/);
    expect(m.text).toContain('nona_outbox_dead 1');
    expect(m.text).toContain('nona_payments_pending 1');
    expect(m.text).toContain('nona_orders{status="PENDING_PAYMENT"} 1');
    const admin = as(app, await login(app, (await createUser(pool, 'ADMIN')).email));
    const sys = (await admin.get('/v1/admin/system')).body;
    expect(sys.alerts.map((a: { code: string }) => a.code)).toContain('OUTBOX_DEAD');
    expect(
      (
        await as(app, await login(app, (await createUser(pool, 'SUPPORT')).email)).get(
          '/v1/admin/system',
        )
      ).status,
    ).toBe(403);
    expect((await request(app.getHttpServer()).get('/v1/admin/system')).status).toBe(401);
    void WEB_ORIGIN;
    void addStock;
  });
});
