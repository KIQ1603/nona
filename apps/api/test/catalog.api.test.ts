import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  apiErrorSchema,
  categoryListResponseSchema,
  productDetailSchema,
  productListResponseSchema,
} from '@nona/contracts';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.factory';
import { clearCatalog, createCategory, createProduct } from './factories';

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
let app: NestExpressApplication;

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.STORAGE_DRIVER = 'memory';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
  process.env.MEDIA_BASE_URL = 'https://cdn.test/media';
  app = await createApp();
  await app.init();
});
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => clearCatalog(pool));

describe('GET /v1/products', () => {
  it('returns a contract-valid page with absolute image URLs and availability', async () => {
    const cat = await createCategory(pool, { slug: 'non-hoa', name: 'Nón họa' });
    await createProduct(pool, {
      categoryId: cat,
      slug: 'sen',
      name: 'Sen',
      variants: [{ price: 590_000, stock: 3 }],
    });
    const res = await request(app.getHttpServer()).get('/v1/products');
    expect(res.status).toBe(200);
    const body = productListResponseSchema.parse(res.body);
    expect(body.items[0]).toMatchObject({
      slug: 'sen',
      priceVnd: 590_000,
      availability: 'LOW_STOCK',
    });
    expect(body.items[0]!.image!.url).toMatch(/^https:\/\/cdn\.test\/media\/test\//);
    expect(body.meta).toEqual({ page: 1, pageSize: 12, total: 1, totalPages: 1 });
    expect(res.headers['cache-control']).toContain('s-maxage');
    expect(res.headers['x-request-id']).toMatch(/^req_/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it.each([
    ['unknown sort', 'sort=rating'],
    ['unknown colour', 'colors=green'],
    ['page size above the cap', 'pageSize=500'],
    ['non-integer price', 'minPriceVnd=1.5'],
    ['repeated scalar param', 'sort=name&sort=featured'],
  ])('rejects %s with the standard error body', async (_label, qs) => {
    const res = await request(app.getHttpServer())
      .get(`/v1/products?${qs}`)
      .set('x-request-id', 'client-req-1234');
    expect(res.status).toBe(400);
    const body = apiErrorSchema.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.requestId).toBe('client-req-1234');
  });

  it('replaces an unsafe client request id', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/products')
      .set('x-request-id', 'bad id\twith spaces');
    expect(res.headers['x-request-id']).toMatch(/^req_[0-9a-f]{32}$/);
  });
});

describe('GET /v1/products/:slug', () => {
  it('returns detail and 404s with the error contract for unknown or unpublished slugs', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, slug: 'live' });
    await createProduct(pool, { categoryId: cat, slug: 'draft', status: 'DRAFT' });
    const ok = await request(app.getHttpServer()).get('/v1/products/live');
    expect(ok.status).toBe(200);
    productDetailSchema.parse(ok.body);
    for (const slug of ['draft', 'missing']) {
      const res = await request(app.getHttpServer()).get(`/v1/products/${slug}`);
      expect(res.status).toBe(404);
      expect(apiErrorSchema.parse(res.body).error.code).toBe('NOT_FOUND');
    }
  });
});

describe('GET /v1/categories', () => {
  it('counts only published products with an active variant', async () => {
    const cat = await createCategory(pool, { slug: 'c1' });
    await createCategory(pool, { slug: 'c2' });
    await createProduct(pool, { categoryId: cat });
    await createProduct(pool, { categoryId: cat, status: 'DRAFT' });
    const res = await request(app.getHttpServer()).get('/v1/categories');
    const body = categoryListResponseSchema.parse(res.body);
    expect(body.items.map((c) => [c.slug, c.productCount])).toEqual([
      ['c1', 1],
      ['c2', 0],
    ]);
  });
});

describe('health', () => {
  it('reports liveness and readiness', async () => {
    expect((await request(app.getHttpServer()).get('/v1/health/live')).body).toEqual({
      status: 'ok',
    });
    const ready = await request(app.getHttpServer()).get('/v1/health/ready');
    expect(ready.status).toBe(200);
    expect(ready.body.checks.database).toBe('ok');
  });
});
