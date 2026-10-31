import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminOrderDetailSchema, orderSchema } from '@nona/contracts';
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
const setManual = (on: boolean) =>
  pool.query(
    `UPDATE site_settings SET value = jsonb_build_object('paymentWindowMinutes', 30, 'requirePhoneVerification', false,
       'requireManualConfirmation', $1::boolean) WHERE key = 'checkout'`,
    [on],
  );
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE outbox_events');
  await setManual(true);
});

const address = {
  fullName: 'Nguyễn Văn A',
  phone: '0912345678',
  line1: '12 Lê Lợi',
  ward: 'Bến Thành',
  district: 'Quận 1',
  province: 'TP. Hồ Chí Minh',
};
async function placeCod(stock = 5) {
  const cat = await createCategory(pool);
  const p = await createProduct(pool, {
    categoryId: cat,
    variants: [{ price: 100_000, stock }],
  });
  const variantId = p.variantIds[0]!;
  const g = guest(app);
  await g.post('/v1/cart/items').send({ variantId, quantity: 2 });
  const res = await g.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
    shippingAddress: address,
    contactEmail: 'khach@example.com',
    paymentMethod: 'COD',
    expectedTotalVnd: 230_000,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const order = orderSchema.parse(res.body);
  const id = (await pool.query('SELECT id FROM orders WHERE public_code = $1', [order.code]))
    .rows[0].id as string;
  return { order, id, variantId };
}
const stock = async (variantId: string) =>
  Number(
    (
      await pool.query(
        'SELECT COALESCE(SUM(delta),0) s FROM inventory_movements WHERE variant_id = $1',
        [variantId],
      )
    ).rows[0].s,
  );
const staff = async () => as(app, await login(app, (await createUser(pool, 'FULFILLMENT')).email));
const detail = async (api: ReturnType<typeof as>, id: string) =>
  adminOrderDetailSchema.parse((await api.get(`/v1/admin/orders/${id}`)).body);

describe('a cash-on-delivery order waits for staff to confirm it by hand', () => {
  it('is created as "Chờ xác nhận", holds the stock, and the email says the shop will call', async () => {
    const { order, id, variantId } = await placeCod();
    expect(order.status).toBe('AWAITING_CONFIRMATION');
    expect(await stock(variantId)).toBe(3); // 5 - 2: it is already reserved for this customer
    const history = (
      await pool.query(
        'SELECT from_status, to_status FROM order_status_history WHERE order_id = $1',
        [id],
      )
    ).rows;
    expect(history).toEqual([{ from_status: null, to_status: 'AWAITING_CONFIRMATION' }]);
    const mail = (await pool.query("SELECT payload FROM outbox_events WHERE type = 'order.placed'"))
      .rows;
    expect(mail[0].payload.awaitingConfirmation).toBe(true);
  });

  it('cannot be prepared before it is confirmed, then confirm moves it on and tells the customer', async () => {
    const { id } = await placeCod();
    const api = await staff();
    let d = await detail(api, id);
    expect(d.status).toBe('AWAITING_CONFIRMATION');
    const early = await api
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'PROCESSING', version: d.version });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('INVALID_STATE_TRANSITION');

    const ok = await api
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'CONFIRMED', version: d.version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    d = adminOrderDetailSchema.parse(ok.body);
    expect(d.status).toBe('CONFIRMED');
    const audit = await pool.query(
      "SELECT 1 FROM audit_logs WHERE action = 'order.status_change' AND target_id = $1",
      [id],
    );
    expect(audit.rowCount).toBe(1);
    const mail = (
      await pool.query("SELECT payload FROM outbox_events WHERE type = 'order.status_changed'")
    ).rows;
    expect(mail.map((m) => m.payload.status)).toEqual(['CONFIRMED']);
    // from here the normal path continues
    const next = await api
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'PROCESSING', version: d.version });
    expect(next.status).toBe(200);
  });

  it('is cancelled with a reason when the number turns out to be fake, and the stock comes back', async () => {
    const { id, variantId } = await placeCod();
    const api = await staff();
    const d = await detail(api, id);
    const noReason = await api
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'CANCELLED', version: d.version });
    expect(noReason.status).toBe(400);
    const res = await api
      .patch(`/v1/admin/orders/${id}/status`)
      .send({
        to: 'CANCELLED',
        version: d.version,
        reason: 'Gọi không được, số điện thoại không đúng',
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await detail(api, id)).status).toBe('CANCELLED');
    expect(await stock(variantId)).toBe(5);
  });

  it('with the switch off, a COD order is confirmed at once as before', async () => {
    await setManual(false);
    const { order } = await placeCod();
    expect(order.status).toBe('CONFIRMED');
  });
});
