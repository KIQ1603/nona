import type { NestExpressApplication } from '@nestjs/platform-express';
import { cartSchema, MAX_LINE_QUANTITY } from '@nona/contracts';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addStock, createCategory, createProduct } from './factories';
import { as, bootApp, cookieFrom, guest, login, register, resetAll, WEB_ORIGIN } from './helpers';
import request from 'supertest';

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

const variant = async (
  opts: {
    price?: number;
    stock?: number;
    slug?: string;
    status?: 'PUBLISHED' | 'DRAFT';
    active?: boolean;
  } = {},
) => {
  const { variantIds, productId } = await createProduct(pool, {
    categoryId: cat,
    slug: opts.slug,
    status: opts.status,
    variants: [{ price: opts.price ?? 100_000, stock: opts.stock ?? 10, active: opts.active }],
  });
  return { id: variantIds[0]!, productId };
};
const parse = (res: request.Response) => cartSchema.parse(res.body);

describe('guest cart', () => {
  it('is empty without a cookie and does not create a cart on read', async () => {
    const g = guest(app);
    const res = await g.get('/v1/cart');
    expect(parse(res)).toMatchObject({ lines: [], itemCount: 0, subtotalVnd: 0 });
    expect(res.headers['cache-control']).toBe('no-store');
    expect((await pool.query('SELECT 1 FROM carts')).rowCount).toBe(0);
  });

  it('sets an HttpOnly cart cookie on first add, stores only its hash, and accumulates quantities', async () => {
    const v = await variant({ price: 590_000 });
    const g = guest(app);
    const first = await g.post('/v1/cart/items').send({ variantId: v.id, quantity: 2 });
    expect(first.status).toBe(201);
    const cookie = (first.headers['set-cookie'] as unknown as string[])[0]!;
    expect(cookie).toMatch(/nona_cart=.+HttpOnly/);
    const stored = (await pool.query('SELECT guest_token_hash FROM carts')).rows[0]
      .guest_token_hash;
    expect(cookie).not.toContain(stored);
    const second = parse(await g.post('/v1/cart/items').send({ variantId: v.id, quantity: 1 }));
    expect(second.lines).toHaveLength(1);
    expect(second).toMatchObject({ itemCount: 3, subtotalVnd: 1_770_000 });
    expect(second.lines[0]).toMatchObject({
      quantity: 3,
      unitPriceVnd: 590_000,
      lineTotalVnd: 1_770_000,
      purchasable: true,
      issue: null,
    });
    expect(parse(await g.get('/v1/cart')).itemCount).toBe(3);
  });

  it('ignores a forged or malformed cart cookie', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/cart')
      .set('Cookie', 'nona_cart=../../etc/passwd');
    expect(parse(res).lines).toEqual([]);
    const res2 = await request(app.getHttpServer())
      .get('/v1/cart')
      .set('Cookie', `nona_cart=${'a'.repeat(43)}`);
    expect(parse(res2).lines).toEqual([]);
  });
});

describe('add / update / remove', () => {
  it('clamps to available stock with a notice, and refuses sold-out or unavailable items', async () => {
    const v = await variant({ stock: 3 });
    const g = guest(app);
    const res = parse(await g.post('/v1/cart/items').send({ variantId: v.id, quantity: 5 }));
    expect(res.lines[0]!.quantity).toBe(3);
    expect(res.notices[0]).toMatchObject({ code: 'QUANTITY_ADJUSTED' });

    const sold = await variant({ stock: 0 });
    const out = await g.post('/v1/cart/items').send({ variantId: sold.id });
    expect(out.status).toBe(409);
    expect(out.body.error.code).toBe('INVENTORY_INSUFFICIENT');

    const draft = await variant({ status: 'DRAFT' });
    expect((await g.post('/v1/cart/items').send({ variantId: draft.id })).status).toBe(409);
    const inactive = await variant({ active: false });
    expect((await g.post('/v1/cart/items').send({ variantId: inactive.id })).status).toBe(409);
    expect(
      (await g.post('/v1/cart/items').send({ variantId: '00000000-0000-4000-8000-000000000000' }))
        .status,
    ).toBe(404);
    expect(parse(await g.get('/v1/cart')).lines).toHaveLength(1);
  });

  it('validates input and caps a line at the maximum', async () => {
    const v = await variant({ stock: 500 });
    const g = guest(app);
    for (const body of [
      { variantId: 'x' },
      { variantId: v.id, quantity: 0 },
      { variantId: v.id, quantity: 1.5 },
      { variantId: v.id, quantity: MAX_LINE_QUANTITY + 1 },
    ]) {
      expect((await g.post('/v1/cart/items').send(body)).status, JSON.stringify(body)).toBe(400);
    }
    await g.post('/v1/cart/items').send({ variantId: v.id, quantity: MAX_LINE_QUANTITY });
    const more = parse(await g.post('/v1/cart/items').send({ variantId: v.id, quantity: 5 }));
    expect(more.lines[0]!.quantity).toBe(MAX_LINE_QUANTITY);
    expect(more.notices[0]!.code).toBe('QUANTITY_ADJUSTED');
  });

  it('updates and removes lines, and cannot touch lines of another cart', async () => {
    const v = await variant();
    const g = guest(app);
    const cart = parse(await g.post('/v1/cart/items').send({ variantId: v.id }));
    const itemId = cart.lines[0]!.id;
    expect(parse(await g.patch(`/v1/cart/items/${itemId}`).send({ quantity: 4 })).itemCount).toBe(
      4,
    );
    expect((await g.patch(`/v1/cart/items/${itemId}`).send({ quantity: 0 })).status).toBe(400);

    const other = guest(app);
    await other.post('/v1/cart/items').send({ variantId: v.id });
    expect((await other.patch(`/v1/cart/items/${itemId}`).send({ quantity: 9 })).status).toBe(404);
    expect((await other.delete(`/v1/cart/items/${itemId}`)).status).toBe(404);
    expect(parse(await g.get('/v1/cart')).itemCount).toBe(4);

    expect(parse(await g.delete(`/v1/cart/items/${itemId}`)).lines).toEqual([]);
    expect((await g.delete(`/v1/cart/items/${itemId}`)).status).toBe(404);
    expect((await g.patch('/v1/cart/items/not-a-uuid').send({ quantity: 1 })).status).toBe(404);
  });

  it('never oversells under concurrent adds of the last units', async () => {
    const v = await variant({ stock: 4 });
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId: v.id });
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        g.post('/v1/cart/items').send({ variantId: v.id, quantity: 2 }),
      ),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    expect(parse(await g.get('/v1/cart')).lines[0]!.quantity).toBeLessThanOrEqual(4);
  });
});

describe('refresh on read: live prices and availability', () => {
  it('shows a price change with the previous price until acknowledged, and totals use the live price', async () => {
    const v = await variant({ price: 500_000 });
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId: v.id, quantity: 2 });
    await pool.query('UPDATE product_variants SET price_vnd = 450000 WHERE id = $1', [v.id]);
    const changed = parse(await g.get('/v1/cart'));
    expect(changed.hasPriceChanges).toBe(true);
    expect(changed.lines[0]).toMatchObject({
      unitPriceVnd: 450_000,
      priceChange: { previousUnitPriceVnd: 500_000 },
    });
    expect(changed.subtotalVnd).toBe(900_000);
    expect(parse(await g.get('/v1/cart')).hasPriceChanges).toBe(true); // reading does not clear it
    const acked = parse(await g.post('/v1/cart/acknowledge-price-changes'));
    expect(acked.hasPriceChanges).toBe(false);
    expect(acked.subtotalVnd).toBe(900_000);
  });

  it('keeps unavailable lines visible with a reason but excludes them from the subtotal', async () => {
    const ok = await variant({ price: 100_000, slug: 'ok' });
    const sold = await variant({ price: 200_000, stock: 5, slug: 'sold' });
    const low = await variant({ price: 300_000, stock: 5, slug: 'low' });
    const gone = await variant({ price: 400_000, stock: 5, slug: 'gone' });
    const g = guest(app);
    for (const [v, q] of [
      [ok, 1],
      [sold, 2],
      [low, 4],
      [gone, 1],
    ] as const)
      await g.post('/v1/cart/items').send({ variantId: v.id, quantity: q });
    await addStock(pool, sold.id, -5, 'SALE');
    await addStock(pool, low.id, -2, 'SALE');
    await pool.query(`UPDATE products SET status = 'ARCHIVED' WHERE id = $1`, [gone.productId]);
    const cart = parse(await g.get('/v1/cart'));
    const by = Object.fromEntries(cart.lines.map((l) => [l.productSlug, l]));
    expect(by.ok).toMatchObject({ purchasable: true, issue: null });
    expect(by.sold).toMatchObject({
      purchasable: false,
      issue: 'OUT_OF_STOCK',
      availableQuantity: 0,
    });
    expect(by.low).toMatchObject({
      purchasable: false,
      issue: 'INSUFFICIENT_STOCK',
      availableQuantity: 3,
      quantity: 4,
    });
    expect(by.gone).toMatchObject({ purchasable: false, issue: 'UNAVAILABLE' });
    expect(cart.hasUnavailable).toBe(true);
    expect(cart.subtotalVnd).toBe(100_000);
    expect(cart.lines).toHaveLength(4);
  });
});

describe('signed-in cart and merge on login', () => {
  it('requires a CSRF token for signed-in writes, but never for guests', async () => {
    const v = await variant();
    const { session } = await register(app, 'c@example.com');
    const noCsrf = await request(app.getHttpServer())
      .post('/v1/cart/items')
      .set('Cookie', session!.cookie)
      .set('Origin', WEB_ORIGIN)
      .send({ variantId: v.id });
    expect(noCsrf.status).toBe(403);
    expect((await as(app, session!).post('/v1/cart/items').send({ variantId: v.id })).status).toBe(
      201,
    );
    expect((await guest(app).post('/v1/cart/items').send({ variantId: v.id })).status).toBe(201);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/cart/items')
          .set('Origin', 'https://evil.example')
          .send({ variantId: v.id })
      ).status,
    ).toBe(403);
  });

  it('persists the user cart across sessions and keeps it private', async () => {
    const v = await variant();
    const { session: a } = await register(app, 'one@example.com');
    await as(app, a!).post('/v1/cart/items').send({ variantId: v.id, quantity: 2 });
    const again = await login(app, 'one@example.com');
    expect(parse(await as(app, again).get('/v1/cart')).itemCount).toBe(2);
    const { session: b } = await register(app, 'two@example.com');
    expect(parse(await as(app, b!).get('/v1/cart')).itemCount).toBe(0);
  });

  it('merges the guest cart into the account on login, capped by availability, and retires the guest cart', async () => {
    const a = await variant({ stock: 3, slug: 'a' });
    const b = await variant({ stock: 10, slug: 'b' });
    const c = await variant({ stock: 0, slug: 'c' });
    const { session } = await register(app, 'merge@example.com');
    await as(app, session!).post('/v1/cart/items').send({ variantId: a.id, quantity: 2 });
    const device2 = await login(app, 'merge@example.com');

    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId: a.id, quantity: 2 });
    await g.post('/v1/cart/items').send({ variantId: b.id, quantity: 1 });
    await pool.query(
      `INSERT INTO cart_items (cart_id, variant_id, quantity, seen_price_vnd) SELECT id, $1, 1, 100000 FROM carts WHERE guest_token_hash IS NOT NULL`,
      [c.id],
    );
    const guestCookie = g.cookie!;

    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', guestCookie)
      .send({ email: 'merge@example.com', password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    expect(
      (res.headers['set-cookie'] as unknown as string[]).some((x) => x.startsWith('nona_cart=;')),
    ).toBe(true);
    const session2 = { cookie: cookieFrom(res, 'nona_session')!, csrf: res.body.csrfToken };

    const merged = parse(await as(app, session2).get('/v1/cart'));
    const qty = Object.fromEntries(merged.lines.map((l) => [l.productSlug, l.quantity]));
    expect(qty).toEqual({ a: 3, b: 1 }); // 2 + 2 capped at stock 3; sold-out line dropped
    expect(parse(await as(app, device2).get('/v1/cart')).itemCount).toBe(4);
    expect(
      (await pool.query('SELECT 1 FROM carts WHERE guest_token_hash IS NOT NULL')).rowCount,
    ).toBe(0);
    const stale = await request(app.getHttpServer()).get('/v1/cart').set('Cookie', guestCookie);
    expect(parse(stale).lines).toEqual([]);
  });

  it('merges even when the account has no cart yet, and also on registration', async () => {
    const v = await variant();
    const g = guest(app);
    await g.post('/v1/cart/items').send({ variantId: v.id, quantity: 3 });
    const start = await request(app.getHttpServer())
      .post('/v1/auth/register/start')
      .set('Origin', WEB_ORIGIN)
      .send({
        identifier: 'new@example.com',
        password: 'correct-horse-battery',
        confirmPassword: 'correct-horse-battery',
        fullName: 'N',
      });
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register/verify')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', g.cookie!)
      .send({ token: start.body.token, code: start.body.devCode });
    const session = { cookie: cookieFrom(res, 'nona_session')!, csrf: res.body.csrfToken };
    expect(parse(await as(app, session).get('/v1/cart')).itemCount).toBe(3);
  });
});
