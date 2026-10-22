import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { quoteSchema } from '@nona/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import { bootApp, guest, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => resetAll(pool, app));

const address = {
  fullName: 'Nguyễn Văn A',
  phone: '0901234567',
  line1: '12 Lê Lợi',
  ward: 'Bến Thành',
  district: 'Quận 1',
  province: 'TP. Hồ Chí Minh',
};
const setup = async () => {
  const cat = await createCategory(pool);
  const mk = (price: number) =>
    createProduct(pool, { categoryId: cat, variants: [{ price, stock: 10 }] }).then(
      (r) => r.variantIds[0]!,
    );
  const [a, b, c] = [await mk(100_000), await mk(200_000), await mk(300_000)];
  const g = guest(app);
  for (const v of [a, b, c]) await g.post('/v1/cart/items').send({ variantId: v, quantity: 1 });
  const cart = (await g.get('/v1/cart')).body;
  const id = (variantId: string) =>
    cart.lines.find((l: { variantId: string }) => l.variantId === variantId).id as string;
  return { g, a: id(a), b: id(b), c: id(c) };
};

describe('buying only some cart lines', () => {
  it('prices only the chosen lines', async () => {
    const { g, a, c } = await setup();
    const q = quoteSchema.parse(
      (await g.post('/v1/checkout/quote').send({ lineIds: [a, c] })).body,
    );
    expect(q.lines).toHaveLength(2);
    expect(q.subtotalVnd).toBe(400_000);
    const all = quoteSchema.parse((await g.post('/v1/checkout/quote').send({})).body);
    expect(all.subtotalVnd).toBe(600_000);
  });

  it('places the order for the chosen lines and leaves the rest in the cart', async () => {
    const { g, a, b, c } = await setup();
    const q = quoteSchema.parse((await g.post('/v1/checkout/quote').send({ lineIds: [b] })).body);
    const placed = await g
      .post('/v1/orders')
      .set('Idempotency-Key', randomUUID())
      .send({
        shippingAddress: address,
        contactEmail: 'a@example.com',
        paymentMethod: 'COD',
        lineIds: [b],
        expectedTotalVnd: q.totalVnd,
      });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    expect(placed.body.items).toHaveLength(1);
    expect(placed.body.subtotalVnd).toBe(200_000);
    const left = (await g.get('/v1/cart')).body.lines.map((l: { id: string }) => l.id).sort();
    expect(left).toEqual([a, c].sort());
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM order_items')).rows[0].n).toBe(1);
  });

  it('refuses an empty or foreign selection and a total that does not match the selection', async () => {
    const { g, b } = await setup();
    const body = (over: object) => ({
      shippingAddress: address,
      contactEmail: 'a@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: 230_000,
      ...over,
    });
    const place = (o: object) =>
      g.post('/v1/orders').set('Idempotency-Key', randomUUID()).send(body(o));
    expect((await place({ lineIds: [randomUUID()] })).status).toBe(409); // nothing of the cart selected
    expect((await place({ lineIds: [] })).status).toBe(400);
    // the shopper saw the whole-cart total but chose one line: the server answers with the real total
    const wrong = await place({ lineIds: [b], expectedTotalVnd: 600_000 + 30_000 });
    expect(wrong.body.error.code).toBe('PRICE_CHANGED');
  });
});
