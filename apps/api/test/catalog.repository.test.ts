import { productListQuerySchema, type ProductListQuery } from '@nona/contracts';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { SqlCatalogRepository } from '../src/modules/catalog/infrastructure/sql-catalog.repository';
import { addStock, clearCatalog, createCategory, createProduct } from './factories';

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
const repo = new SqlCatalogRepository({
  query: (t: string, v?: unknown[]) => pool.query(t, v),
} as never);
const q = (raw: Record<string, unknown> = {}): ProductListQuery =>
  productListQuerySchema.parse(raw);

beforeEach(() => clearCatalog(pool));
afterAll(() => pool.end());

describe('listProducts visibility', () => {
  it('lists only published products that have an active variant', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, name: 'Visible' });
    await createProduct(pool, { categoryId: cat, name: 'Draft', status: 'DRAFT' });
    await createProduct(pool, { categoryId: cat, name: 'Archived', status: 'ARCHIVED' });
    await createProduct(pool, {
      categoryId: cat,
      name: 'No active variant',
      variants: [{ price: 1000, active: false }],
    });
    const page = await repo.listProducts(q());
    expect(page.records.map((r) => r.name)).toEqual(['Visible']);
    expect(page.total).toBe(1);
  });
});

describe('availability is derived from the inventory ledger', () => {
  it('sums receipts, sales and adjustments; never negative; ignores inactive variants', async () => {
    const cat = await createCategory(pool);
    const { variantIds } = await createProduct(pool, {
      categoryId: cat,
      variants: [
        { price: 100_000, stock: 10 },
        { price: 120_000, stock: 4 },
        { price: 90_000, stock: 50, active: false },
      ],
    });
    await addStock(pool, variantIds[0]!, -3, 'SALE');
    const page = await repo.listProducts(q());
    expect(page.records[0]!.availableQuantity).toBe(11); // (10-3) + 4, inactive excluded
  });

  it('reports zero for oversold variants instead of negatives', async () => {
    const cat = await createCategory(pool);
    const { variantIds } = await createProduct(pool, {
      categoryId: cat,
      variants: [{ price: 1, stock: 2 }],
    });
    await addStock(pool, variantIds[0]!, -5, 'ADJUSTMENT');
    const [r] = (await repo.listProducts(q())).records;
    expect(r!.availableQuantity).toBe(0);
  });
});

describe('inventory ledger is append-only', () => {
  it('rejects UPDATE and DELETE', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, variants: [{ price: 1, stock: 2 }] });
    await expect(pool.query('UPDATE inventory_movements SET delta = 99')).rejects.toThrow(
      /append-only/,
    );
    await expect(pool.query('DELETE FROM inventory_movements')).rejects.toThrow(/append-only/);
  });
});

describe('filters', () => {
  it('filters by category, colour, style and price range', async () => {
    const a = await createCategory(pool, { slug: 'a' });
    const b = await createCategory(pool, { slug: 'b' });
    await createProduct(pool, {
      categoryId: a,
      name: 'A1',
      color: 'red',
      style: 'floral',
      variants: [{ price: 300_000, stock: 1 }],
    });
    await createProduct(pool, {
      categoryId: a,
      name: 'A2',
      color: 'blue',
      style: 'modern',
      variants: [{ price: 700_000, stock: 1 }],
    });
    await createProduct(pool, {
      categoryId: b,
      name: 'B1',
      color: 'red',
      style: 'modern',
      variants: [{ price: 500_000, stock: 1 }],
    });
    const names = async (raw: Record<string, unknown>) =>
      (await repo.listProducts(q({ sort: 'name', ...raw }))).records.map((r) => r.name);
    expect(await names({ category: 'a' })).toEqual(['A1', 'A2']);
    expect(await names({ colors: 'red' })).toEqual(['A1', 'B1']);
    expect(await names({ colors: 'red,blue', styles: 'modern' })).toEqual(['A2', 'B1']);
    expect(await names({ maxPriceVnd: 500_000 })).toEqual(['A1', 'B1']);
    expect(await names({ minPriceVnd: 600_000 })).toEqual(['A2']);
    expect(await names({ category: 'missing' })).toEqual([]);
  });

  it('searches accent-insensitively and treats LIKE wildcards literally', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, name: 'Nón Sen Đẹp', summary: 'Hoa sen' });
    await createProduct(pool, { categoryId: cat, name: 'Nón Trúc' });
    const names = async (term: string) =>
      (await repo.listProducts(q({ q: term }))).records.map((r) => r.name);
    expect(await names('non sen')).toEqual(['Nón Sen Đẹp']);
    expect(await names('dep')).toEqual(['Nón Sen Đẹp']);
    expect(await names('%')).toEqual([]);
    expect(await names('_')).toEqual([]);
  });
});

describe('sorting and pagination', () => {
  it('sorts deterministically by price and name (Vietnamese collation)', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, {
      categoryId: cat,
      name: 'Zeta',
      variants: [{ price: 200, stock: 1 }],
      sortWeight: 1,
    });
    await createProduct(pool, {
      categoryId: cat,
      name: 'Ất',
      variants: [{ price: 100, stock: 1 }],
      sortWeight: 3,
    });
    await createProduct(pool, {
      categoryId: cat,
      name: 'Alpha',
      variants: [{ price: 300, stock: 1 }],
      sortWeight: 2,
    });
    const names = async (sort: string) =>
      (await repo.listProducts(q({ sort }))).records.map((r) => r.name);
    expect(await names('price-asc')).toEqual(['Ất', 'Zeta', 'Alpha']);
    expect(await names('price-desc')).toEqual(['Alpha', 'Zeta', 'Ất']);
    expect(await names('featured')).toEqual(['Ất', 'Alpha', 'Zeta']);
    expect(await names('name')).toEqual(['Alpha', 'Ất', 'Zeta']);
  });

  it('paginates without overlap and reports the total, even past the last page', async () => {
    const cat = await createCategory(pool);
    for (let i = 0; i < 5; i++) await createProduct(pool, { categoryId: cat, sortWeight: i });
    const p1 = await repo.listProducts(q({ pageSize: 2, page: 1 }));
    const p2 = await repo.listProducts(q({ pageSize: 2, page: 2 }));
    const p3 = await repo.listProducts(q({ pageSize: 2, page: 3 }));
    const p4 = await repo.listProducts(q({ pageSize: 2, page: 4 }));
    const ids = [...p1.records, ...p2.records, ...p3.records].map((r) => r.id);
    expect(new Set(ids).size).toBe(5);
    expect([p1.total, p2.total, p3.total, p4.total]).toEqual([5, 5, 5, 5]);
    expect(p4.records).toEqual([]);
  });
});

describe('price display', () => {
  it('uses the cheapest active variant and flags a price range', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, {
      categoryId: cat,
      variants: [
        { price: 500, compareAt: 600, stock: 1 },
        { price: 400, compareAt: 450, stock: 1 },
      ],
    });
    const [r] = (await repo.listProducts(q())).records;
    expect(r).toMatchObject({
      minPriceVnd: 400,
      maxPriceVnd: 500,
      compareAtPriceVnd: 450,
      variantCount: 2,
    });
  });
});

describe('findProductBySlug', () => {
  it('returns detail with images and variants, and hides unpublished products', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, {
      categoryId: cat,
      slug: 'live',
      variants: [
        { price: 100, stock: 3 },
        { price: 200, stock: 0 },
      ],
    });
    await createProduct(pool, { categoryId: cat, slug: 'hidden', status: 'DRAFT' });
    const live = await repo.findProductBySlug('live');
    expect(live?.variants.map((v) => v.availableQuantity)).toEqual([3, 0]);
    expect(live?.images).toHaveLength(1);
    expect(await repo.findProductBySlug('hidden')).toBeNull();
    expect(await repo.findProductBySlug('nope')).toBeNull();
  });
});
