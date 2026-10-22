import type pg from 'pg';

let counter = 0;
const next = () => ++counter;

export async function createCategory(
  db: pg.Pool,
  overrides: { slug?: string; name?: string; sortOrder?: number } = {},
) {
  const n = next();
  const { rows } = await db.query<{ id: string }>(
    'INSERT INTO categories (slug, name, sort_order) VALUES ($1,$2,$3) RETURNING id',
    [overrides.slug ?? `cat-${n}`, overrides.name ?? `Category ${n}`, overrides.sortOrder ?? n],
  );
  return rows[0]!.id;
}

export interface ProductInput {
  categoryId: string;
  name?: string;
  slug?: string;
  status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  color?: string | null;
  style?: string | null;
  sortWeight?: number;
  summary?: string | null;
  withImage?: boolean;
  customizable?: boolean;
  variants?: { price: number; compareAt?: number | null; stock?: number; active?: boolean }[];
}

/** Creates a product with explicit variants/stock so each test states the exact state it depends on. */
export async function createProduct(db: pg.Pool, input: ProductInput) {
  const n = next();
  const status = input.status ?? 'PUBLISHED';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO products (category_id, slug, name, summary, status, color_code, style_code, sort_weight, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $5 = 'PUBLISHED' THEN now() END) RETURNING id`,
    [
      input.categoryId,
      input.slug ?? `product-${n}`,
      input.name ?? `Product ${n}`,
      input.summary ?? null,
      status,
      input.color ?? null,
      input.style ?? null,
      input.sortWeight ?? 0,
    ],
  );
  const productId = rows[0]!.id;
  if (input.customizable !== undefined)
    await db.query('UPDATE products SET is_customizable = $2 WHERE id = $1', [
      productId,
      input.customizable,
    ]);
  if (input.withImage !== false) {
    await db.query(
      `INSERT INTO product_images (product_id, object_key, alt, width, height) VALUES ($1,$2,'alt',400,500)`,
      [productId, `test/${productId}.svg`],
    );
  }
  const variantIds: string[] = [];
  for (const [i, v] of (input.variants ?? [{ price: 100_000, stock: 10 }]).entries()) {
    const res = await db.query<{ id: string }>(
      `INSERT INTO product_variants (product_id, sku, name, price_vnd, compare_at_price_vnd, is_active, position)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        productId,
        `SKU-${n}-${i}`,
        `Variant ${i}`,
        v.price,
        v.compareAt ?? null,
        v.active ?? true,
        i,
      ],
    );
    variantIds.push(res.rows[0]!.id);
    if (v.stock) await addStock(db, res.rows[0]!.id, v.stock);
  }
  return { productId, variantIds };
}

export async function addStock(db: pg.Pool, variantId: string, delta: number, reason = 'RECEIPT') {
  await db.query('INSERT INTO inventory_movements (variant_id, delta, reason) VALUES ($1,$2,$3)', [
    variantId,
    delta,
    reason,
  ]);
}

export async function clearCatalog(db: pg.Pool) {
  await db.query(
    'TRUNCATE inventory_movements, product_images, product_variants, products, categories CASCADE',
  );
}
