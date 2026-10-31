import type { NestExpressApplication } from '@nestjs/platform-express';
import { categoryListResponseSchema, productListResponseSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import { as, bootApp, createUser, login, resetAll, type Session } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
let admin: Session;
const api = () => as(app, admin);
const get = (url: string) => request(app.getHttpServer()).get(url);

beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool);
  admin = await login(app, (await createUser(pool, 'ADMIN')).email);
});

const type = async (name: string, slug: string, sortOrder = 0) =>
  (await api().post('/v1/admin/categories').send({ name, slug, sortOrder })).body.id as string;
const group = async (name: string, slug: string, parentId: string) =>
  api().post('/v1/admin/categories').send({ name, slug, parentId });
const stocked = (categoryId: string, extra: { sortWeight?: number } = {}) =>
  createProduct(pool, { categoryId, variants: [{ price: 100_000, stock: 5 }], ...extra });

describe('product types and groups', () => {
  it('a category without a parent is a type; a group names its type and counts into it', async () => {
    const nonLa = await type('Nón lá', 'non-la', 0);
    const mocKhoa = await type('Móc khóa', 'moc-khoa', 1);
    const truyenThong = (await group('Nón truyền thống', 'non-truyen-thong', nonLa)).body.id;
    await stocked(truyenThong);
    await stocked(truyenThong);
    await stocked(mocKhoa);

    const { items } = categoryListResponseSchema.parse((await get('/v1/categories')).body);
    const by = Object.fromEntries(items.map((c) => [c.slug, c]));
    expect(by['non-la']).toMatchObject({ parentSlug: null, productCount: 2 });
    expect(by['non-truyen-thong']).toMatchObject({ parentSlug: 'non-la', productCount: 2 });
    expect(by['moc-khoa']).toMatchObject({ parentSlug: null, productCount: 1 });
    // types come before their groups
    expect(items.map((c) => c.slug)).toEqual(['non-la', 'moc-khoa', 'non-truyen-thong']);
  });

  it('filtering by a type returns the products of all its groups, a group only its own', async () => {
    const nonLa = await type('Nón lá', 'non-la');
    const mocKhoa = await type('Móc khóa', 'moc-khoa');
    const a = (await group('Nón họa', 'non-hoa', nonLa)).body.id;
    const b = (await group('Nón cô dâu', 'non-co-dau', nonLa)).body.id;
    await stocked(a);
    await stocked(b);
    await stocked(nonLa); // directly in the type
    await stocked(mocKhoa);
    const count = async (slug: string) =>
      productListResponseSchema.parse((await get(`/v1/products?category=${slug}`)).body).meta.total;
    expect(await count('non-la')).toBe(3);
    expect(await count('non-hoa')).toBe(1);
    expect(await count('moc-khoa')).toBe(1);
  });

  it('shows only the products the admin marked as featured when asked', async () => {
    const nonLa = await type('Nón lá', 'non-la');
    const first = await stocked(nonLa);
    await stocked(nonLa);
    await pool.query('UPDATE products SET is_featured = true WHERE id = $1', [first.productId]);
    const res = productListResponseSchema.parse(
      (await get('/v1/products?category=non-la&featured=true')).body,
    );
    expect(res.items.map((p) => p.id)).toEqual([first.productId]);
    expect((await get('/v1/products?featured=false')).status).toBe(400);
  });

  it('the admin sets "featured" on a product and can read it back', async () => {
    const nonLa = await type('Nón lá', 'non-la');
    const created = (
      await api()
        .post('/v1/admin/products')
        .send({ name: 'Nón Sen', categoryId: nonLa, isFeatured: true })
    ).body;
    expect(created.isFeatured).toBe(true);
    const off = await api()
      .patch(`/v1/admin/products/${created.id}`)
      .send({ isFeatured: false, version: created.version });
    expect(off.status, JSON.stringify(off.body)).toBe(200);
    expect(off.body.isFeatured).toBe(false);
  });

  describe('admin rules', () => {
    it('only a type can be a parent (two levels), never itself, and a type with groups cannot move under another', async () => {
      const nonLa = await type('Nón lá', 'non-la');
      const mocKhoa = await type('Móc khóa', 'moc-khoa');
      const g = (await group('Nón họa', 'non-hoa', nonLa)).body.id;

      const underGroup = await group('Con của nhóm', 'con-cua-nhom', g);
      expect(underGroup.status).toBe(400);
      const missing = await group('Mồ côi', 'mo-coi', '00000000-0000-4000-8000-000000000000');
      expect(missing.status).toBe(400);

      const self = await api().patch(`/v1/admin/categories/${nonLa}`).send({ parentId: nonLa });
      expect(self.status).toBe(400);
      const move = await api().patch(`/v1/admin/categories/${nonLa}`).send({ parentId: mocKhoa });
      expect(move.status).toBe(400); // it has a group
      const regroup = await api().patch(`/v1/admin/categories/${g}`).send({ parentId: mocKhoa });
      expect(regroup.status).toBe(200);
      const list = (await api().get('/v1/admin/categories')).body.items;
      expect(list.find((c: { id: string }) => c.id === g).parentId).toBe(mocKhoa);
      // promote a group back to a type
      const promote = await api().patch(`/v1/admin/categories/${g}`).send({ parentId: null });
      expect(promote.status).toBe(200);
    });

    it('refuses to delete a type that still has groups', async () => {
      const nonLa = await type('Nón lá', 'non-la');
      await group('Nón họa', 'non-hoa', nonLa);
      const res = await api().delete(`/v1/admin/categories/${nonLa}`);
      expect(res.status).toBe(409);
    });
  });
});
