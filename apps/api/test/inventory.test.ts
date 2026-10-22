import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, bootApp, createUser, login, resetAll, type Session } from './helpers';
import { createCategory, createProduct } from './factories';

let app: NestExpressApplication;
let pool: pg.Pool;
let session: Session;
let variantId: string;
const api = () => as(app, session);
const adjust = (body: object, key?: string) => {
  const r = api().post('/v1/admin/inventory/adjustments');
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};
const stock = async () =>
  Number(
    (
      await pool.query(
        'SELECT COALESCE(SUM(delta),0) s FROM inventory_movements WHERE variant_id = $1',
        [variantId],
      )
    ).rows[0].s,
  );

beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool);
  session = await login(app, (await createUser(pool, 'CATALOG')).email);
  const cat = await createCategory(pool);
  variantId = (
    await createProduct(pool, { categoryId: cat, variants: [{ price: 100_000, stock: 5 }] })
  ).variantIds[0]!;
});

describe('POST /v1/admin/inventory/adjustments', () => {
  it('requires an Idempotency-Key', async () => {
    const res = await adjust({ variantId, delta: 1, reason: 'RECEIPT' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(await stock()).toBe(5);
  });

  it('appends a movement, audits it, and replays the same key without a second effect', async () => {
    const first = await adjust(
      { variantId, delta: 10, reason: 'RECEIPT', note: 'Nhập lô 1' },
      'key-receipt-0001',
    );
    expect(first.status).toBe(201);
    expect(first.body.stock).toBe(15);
    const replay = await adjust(
      { variantId, delta: 10, reason: 'RECEIPT', note: 'Nhập lô 1' },
      'key-receipt-0001',
    );
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
    expect(await stock()).toBe(15);
    const audit = await pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'inventory.adjust'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].metadata).toMatchObject({ before: 5, after: 15, delta: 10 });
  });

  it('rejects reuse of a key with different input', async () => {
    await adjust({ variantId, delta: 1, reason: 'RECEIPT' }, 'key-reuse-00001');
    const res = await adjust({ variantId, delta: 2, reason: 'RECEIPT' }, 'key-reuse-00001');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await stock()).toBe(6);
  });

  it('never lets stock go negative and does not cache failures under the key', async () => {
    const res = await adjust({ variantId, delta: -6, reason: 'ADJUSTMENT' }, 'key-negative-001');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('INVENTORY_INSUFFICIENT');
    expect(res.body.error.details.currentStock).toBe(5);
    expect(await stock()).toBe(5);
    // The failed attempt rolled back, so the key is free to be reused (with a corrected request).
    expect(
      (await adjust({ variantId, delta: -5, reason: 'ADJUSTMENT' }, 'key-negative-001')).status,
    ).toBe(201);
    expect(await stock()).toBe(0);
  });

  it('serializes concurrent adjustments so only what fits is applied', async () => {
    const results = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        adjust({ variantId, delta: -3, reason: 'ADJUSTMENT' }, `key-race-00000${i}`),
      ),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    expect(await stock()).toBe(2);
  });

  it('validates direction, size and existence', async () => {
    expect(
      (await adjust({ variantId, delta: -1, reason: 'RECEIPT' }, 'key-dir-0000001')).status,
    ).toBe(400);
    expect(
      (await adjust({ variantId, delta: 0, reason: 'ADJUSTMENT' }, 'key-zero-000001')).status,
    ).toBe(400);
    expect(
      (await adjust({ variantId, delta: 1.5, reason: 'ADJUSTMENT' }, 'key-frac-000001')).status,
    ).toBe(400);
    expect(
      (
        await adjust(
          { variantId: '00000000-0000-4000-8000-000000000000', delta: 1, reason: 'RECEIPT' },
          'key-miss-000001',
        )
      ).status,
    ).toBe(404);
  });

  it('is forbidden without inventory:write', async () => {
    const finance = await login(app, (await createUser(pool, 'FINANCE')).email);
    const res = await as(app, finance)
      .post('/v1/admin/inventory/adjustments')
      .set('Idempotency-Key', 'key-forbid-00001')
      .send({ variantId, delta: 1, reason: 'RECEIPT' });
    expect(res.status).toBe(403);
    expect(await stock()).toBe(5);
  });

  it('exposes movement history with the running stock', async () => {
    await adjust({ variantId, delta: 2, reason: 'RECEIPT' }, 'key-hist-0000001');
    const res = await api().get(`/v1/admin/variants/${variantId}/inventory`);
    expect(res.body.stock).toBe(7);
    expect(res.body.movements.map((m: { delta: number }) => m.delta)).toEqual([2, 5]);
  });
});
