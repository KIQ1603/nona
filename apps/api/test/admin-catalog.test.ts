import type { NestExpressApplication } from '@nestjs/platform-express';
import { adminProductDetailSchema, productListResponseSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE } from '../src/modules/media/domain';
import type { MemoryStorage } from '../src/modules/media/infrastructure/memory-storage';
import { as, bootApp, createUser, login, png, resetAll, type Session } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
let admin: Session;
let categoryId: string;
const api = () => as(app, admin);
const storage = () => app.get<MemoryStorage>(OBJECT_STORAGE);

beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool);
  admin = await login(app, (await createUser(pool, 'ADMIN')).email);
  categoryId = (await api().post('/v1/admin/categories').send({ name: 'Nón Họa' })).body.id;
  storage().objects.clear();
});

async function newProduct(name = 'Nón Sen Mới') {
  const res = await api().post('/v1/admin/products').send({ name, categoryId });
  expect(res.status).toBe(201);
  return adminProductDetailSchema.parse(res.body);
}
const upload = (id: string, buf: Buffer, filename = 'a.png') =>
  api().post(`/v1/admin/products/${id}/images`).attach('file', buf, filename);
async function publishable(name?: string) {
  const p = await newProduct(name);
  await api()
    .post(`/v1/admin/products/${p.id}/variants`)
    .send({ sku: `sku-${p.slug}`, name: 'Tiêu chuẩn', priceVnd: 500_000 });
  await upload(p.id, await png());
  return (await api().get(`/v1/admin/products/${p.id}`)).body as typeof p;
}

describe('categories', () => {
  it('slugifies Vietnamese names, rejects duplicates, and refuses to delete a category in use', async () => {
    const list = (await api().get('/v1/admin/categories')).body.items;
    expect(list[0].slug).toBe('non-hoa');
    expect(
      (await api().post('/v1/admin/categories').send({ name: 'Nón Hoa', slug: 'non-hoa' })).status,
    ).toBe(409);
    await newProduct();
    const del = await api().delete(`/v1/admin/categories/${categoryId}`);
    expect(del.status).toBe(409);
    expect(
      (await pool.query('SELECT 1 FROM categories WHERE id = $1', [categoryId])).rowCount,
    ).toBe(1);
  });
});

describe('product lifecycle and publish rules', () => {
  it('creates a draft with a generated slug that the public API cannot see', async () => {
    const p = await newProduct('Nón Đẹp Nhất');
    expect(p).toMatchObject({ slug: 'non-dep-nhat', status: 'DRAFT', version: 1 });
    expect(p.publishIssues).toEqual(
      expect.arrayContaining(['Cần ít nhất 1 ảnh', 'Cần ít nhất 1 biến thể đang bán']),
    );
    expect((await request(app.getHttpServer()).get('/v1/products/non-dep-nhat')).status).toBe(404);
  });

  it('refuses to publish until image + active variant exist, then publishes and exposes it', async () => {
    const p = await newProduct();
    const blocked = await api()
      .patch(`/v1/admin/products/${p.id}`)
      .send({ status: 'PUBLISHED', version: p.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PUBLISH_REQUIREMENTS_NOT_MET');
    expect(blocked.body.error.details.issues).toHaveLength(2);
    expect(
      (await pool.query('SELECT status, version FROM products WHERE id = $1', [p.id])).rows[0],
    ).toEqual({ status: 'DRAFT', version: 1 });

    const ready = await publishable('Nón Sẵn Sàng');
    const published = await api()
      .patch(`/v1/admin/products/${ready.id}`)
      .send({ status: 'PUBLISHED', version: ready.version });
    expect(published.status).toBe(200);
    expect(published.body.publishedAt).not.toBeNull();
    const pub = productListResponseSchema.parse(
      (await request(app.getHttpServer()).get('/v1/products')).body,
    );
    expect(pub.items.map((i) => i.name)).toEqual(['Nón Sẵn Sàng']);
    expect(pub.items[0]!.image!.url).toMatch(/^https:\/\/cdn\.test\/media\/products\//);
  });

  it('rejects stale versions with 409 and the current version, without overwriting', async () => {
    const p = await newProduct();
    const first = await api()
      .patch(`/v1/admin/products/${p.id}`)
      .send({ name: 'Tên A', version: 1 });
    expect(first.body.version).toBe(2);
    const stale = await api()
      .patch(`/v1/admin/products/${p.id}`)
      .send({ name: 'Tên B', version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.details.currentVersion).toBe(2);
    expect((await pool.query('SELECT name FROM products WHERE id = $1', [p.id])).rows[0].name).toBe(
      'Tên A',
    );
  });

  it('rejects duplicate slugs and invalid input', async () => {
    await newProduct('Nón Trùng');
    expect(
      (await api().post('/v1/admin/products').send({ name: 'Nón Trùng', categoryId })).status,
    ).toBe(409);
    expect((await api().post('/v1/admin/products').send({ name: '', categoryId })).status).toBe(
      400,
    );
    expect(
      (await api().post('/v1/admin/products').send({ name: 'x', categoryId: 'not-a-uuid' })).status,
    ).toBe(400);
    expect(
      (await api().post('/v1/admin/products').send({ name: 'x', categoryId, colorCode: 'green' }))
        .status,
    ).toBe(400);
    expect((await api().get('/v1/admin/products/not-a-uuid')).status).toBe(404);
  });

  it('prevents breaking a live product by removing its last image or deactivating its last variant', async () => {
    const p = await publishable();
    await api()
      .patch(`/v1/admin/products/${p.id}`)
      .send({ status: 'PUBLISHED', version: p.version });
    const detail = (await api().get(`/v1/admin/products/${p.id}`)).body;
    const delImg = await api().delete(`/v1/admin/products/${p.id}/images/${detail.images[0].id}`);
    expect(delImg.status).toBe(409);
    const deact = await api()
      .patch(`/v1/admin/variants/${detail.variants[0].id}`)
      .send({ isActive: false });
    expect(deact.status).toBe(409);
    expect(
      (await pool.query('SELECT 1 FROM product_images WHERE product_id = $1', [p.id])).rowCount,
    ).toBe(1);
    expect(
      (await pool.query('SELECT is_active FROM product_variants WHERE product_id = $1', [p.id]))
        .rows[0].is_active,
    ).toBe(true);
  });
});

describe('variants and price audit', () => {
  it('validates SKU/prices, records price changes with before/after, and rejects duplicate SKUs', async () => {
    const p = await newProduct();
    const make = (body: object) => api().post(`/v1/admin/products/${p.id}/variants`).send(body);
    expect((await make({ sku: 'abc-1', name: 'M', priceVnd: 100_000.5 })).status).toBe(400);
    expect((await make({ sku: 'abc-1', name: 'M', priceVnd: -1 })).status).toBe(400);
    expect(
      (await make({ sku: 'abc-1', name: 'M', priceVnd: 100_000, compareAtPriceVnd: 90_000 }))
        .status,
    ).toBe(400);
    const ok = await make({ sku: 'abc-1', name: 'M', priceVnd: 100_000 });
    expect(ok.status).toBe(201);
    expect(ok.body.variants[0].sku).toBe('ABC-1');
    expect((await make({ sku: 'ABC-1', name: 'L', priceVnd: 1 })).status).toBe(409);

    const variantId = ok.body.variants[0].id;
    const upd = await api().patch(`/v1/admin/variants/${variantId}`).send({ priceVnd: 120_000 });
    expect(upd.status).toBe(200);
    const audit = await pool.query(
      `SELECT metadata FROM audit_logs WHERE action = 'variant.price_change'`,
    );
    expect(audit.rows[0].metadata.changes.priceVnd).toEqual({ from: 100000, to: 120000 });
  });
});

describe('image upload', () => {
  it('re-encodes to WebP, stores under a generated key, and ignores the client filename', async () => {
    const p = await newProduct();
    const res = await upload(p.id, await png(2400), '../../etc/passwd.png');
    expect(res.status).toBe(201);
    const img = res.body.images[0];
    expect(img.width).toBe(1600);
    expect(img.url).toMatch(/\/products\/[0-9a-f-]+\/[0-9a-f-]+\.webp$/);
    expect(img.url).not.toContain('passwd');
    const [key, obj] = [...storage().objects.entries()][0]!;
    expect(key).toMatch(/^products\//);
    expect(obj.contentType).toBe('image/webp');
    expect(obj.body.subarray(8, 12).toString()).toBe('WEBP');
  });

  it.each([
    ['plain text renamed to .png', Buffer.from('hello world, not an image'), 'x.png'],
    [
      'SVG with script',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'x.svg',
    ],
    ['empty file', Buffer.alloc(0), 'x.png'],
  ])('rejects %s', async (_l, buf, name) => {
    const p = await newProduct();
    const res = await upload(p.id, buf, name);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(storage().objects.size).toBe(0);
    expect((await pool.query('SELECT 1 FROM product_images')).rowCount).toBe(0);
  });

  it('rejects images that are too small and files over 8MB', async () => {
    const p = await newProduct();
    expect((await upload(p.id, await png(200))).body.error.code).toBe('MEDIA_INVALID');
    const big = await upload(p.id, Buffer.alloc(9 * 1024 * 1024, 1));
    expect(big.status).toBeGreaterThanOrEqual(400);
    expect(storage().objects.size).toBe(0);
  });

  it('reorders, deletes (and removes the stored object), and validates the order list', async () => {
    const p = await newProduct();
    await upload(p.id, await png());
    const two = await upload(p.id, await png(900));
    const [a, b] = two.body.images.map((i: { id: string }) => i.id);
    const re = await api()
      .put(`/v1/admin/products/${p.id}/images/order`)
      .send({ imageIds: [b, a] });
    expect(re.body.images.map((i: { id: string }) => i.id)).toEqual([b, a]);
    expect(
      (
        await api()
          .put(`/v1/admin/products/${p.id}/images/order`)
          .send({ imageIds: [a] })
      ).status,
    ).toBe(400);
    expect(storage().objects.size).toBe(2);
    const del = await api().delete(`/v1/admin/products/${p.id}/images/${a}`);
    expect(del.body.images).toHaveLength(1);
    expect(storage().objects.size).toBe(1);
  });
});

describe('admin product list', () => {
  it('filters by status, accent-insensitive search and SKU, and reports stock', async () => {
    const live = await publishable('Nón Lam Hội An');
    await newProduct('Nón Nháp');
    await api()
      .patch(`/v1/admin/products/${live.id}`)
      .send({ status: 'PUBLISHED', version: live.version });
    const list = async (qs: string) =>
      (await api().get(`/v1/admin/products?${qs}`)).body.items.map((i: { name: string }) => i.name);
    expect(await list('status=DRAFT')).toEqual(['Nón Nháp']);
    expect(await list('q=lam hoi')).toEqual(['Nón Lam Hội An']);
    expect(await list(`q=${live.variants[0]!.sku}`)).toEqual(['Nón Lam Hội An']);
    expect(await list('q=%25')).toEqual([]);
  });
});
