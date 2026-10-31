// Puts a couple of sample hats (published, with a picture and stock) into the shop through the admin API, so it works
// against any environment (local, Render). Never touches existing data: a product whose slug already exists is skipped.
//
//   API_URL=https://nona-1.onrender.com ADMIN_EMAIL=... ADMIN_PASSWORD=... \
//   WEB_ORIGIN=https://nona-eta.vercel.app node scripts/seed-products.mjs
//
// The names, prices, stock and pictures are SAMPLE values: replace them in the admin (Sản phẩm).
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = (process.env.API_URL ?? 'http://localhost:4100').replace(/\/$/, '');
const ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3100';

const PRODUCTS = [
  {
    slug: 'non-la-ve-hoa-sen',
    name: 'Nón lá vẽ hoa sen',
    summary: 'Nón lá Làng Chuông vẽ tay họa tiết sen đỏ trên nền lá mộc.',
    description:
      'Nón lá Làng Chuông được chằm thủ công, vẽ tay họa tiết hoa sen. Dáng nón nhẹ, vành đều, phù hợp làm phụ kiện hằng ngày hoặc trang trí thêm bằng thiết kế riêng.',
    badge: 'Bán chạy',
    colorCode: 'natural',
    styleCode: 'floral',
    hatWidthCm: 40,
    hatHeightCm: 20,
    sku: 'NONA-NON-LA-SEN-STD',
    priceVnd: 350000,
    stock: 20,
    image: 'non-hoa-sen.jpg',
    alt: 'Nón lá vẽ hoa sen đỏ',
  },
  {
    slug: 'non-la-sen-hong-ve-tay',
    name: 'Nón lá sen hồng vẽ tay',
    summary: 'Nón lá vẽ sen hồng và lá xanh, hoàn thiện từng nét bởi nghệ nhân.',
    description:
      'Mỗi chiếc nón được vẽ tay từng cánh sen hồng, lá xanh trên nền lá mềm. Thích hợp làm quà tặng hoặc để thiết kế thêm sticker trang trí.',
    badge: 'Mới',
    colorCode: 'pink',
    styleCode: 'floral',
    hatWidthCm: 40,
    hatHeightCm: 20,
    sku: 'NONA-NON-LA-SEN-HONG-STD',
    priceVnd: 420000,
    stock: 15,
    image: 'non-sen-ve-tay.jpg',
    alt: 'Nón lá vẽ sen hồng bằng tay',
  },
];

const must = async (res, what) => {
  if (!res.ok) throw new Error(`${what}: ${res.status} ${await res.text()}`);
  return res;
};

const login = await must(
  await fetch(`${API}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL ?? 'admin@local',
      password: process.env.ADMIN_PASSWORD ?? '1',
    }),
  }),
  'login',
);
const me = await login.json();
if (me.mfaRequired)
  throw new Error('This admin needs a one-time code (MFA): add the products on the web instead.');
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
const headers = { cookie, origin: ORIGIN, 'x-csrf-token': me.csrfToken };
const json = { ...headers, 'content-type': 'application/json' };

const { items: categories } = await (
  await must(await fetch(`${API}/v1/admin/categories`, { headers }), 'categories')
).json();
const type = categories.find((c) => c.slug === 'non-la' && !c.parentId);
if (!type) throw new Error('Category "non-la" is missing: run the database migrations first.');

const post = (url, body, what) =>
  must(
    fetch(`${API}/v1/admin/${url}`, {
      method: 'POST',
      headers: { ...json, 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
    what,
  ).then((r) => r.json());

// Resumable: every step is skipped when its result is already there, so a half-finished run can simply be repeated.
for (const p of PRODUCTS) {
  const found = await (
    await must(await fetch(`${API}/v1/admin/products?q=${p.slug}&pageSize=5`, { headers }), 'find')
  ).json();
  let id = found.items.find((x) => x.slug === p.slug)?.id;
  id ??= (
    await post(
      'products',
      {
        name: p.name,
        slug: p.slug,
        categoryId: type.id,
        summary: p.summary,
        description: p.description,
        badge: p.badge,
        colorCode: p.colorCode,
        styleCode: p.styleCode,
        hatWidthCm: p.hatWidthCm,
        hatHeightCm: p.hatHeightCm,
        isCustomizable: true,
        isFeatured: true,
      },
      `create ${p.slug}`,
    )
  ).id;
  let detail = await (
    await must(await fetch(`${API}/v1/admin/products/${id}`, { headers }), 'detail')
  ).json();
  if (detail.status === 'PUBLISHED') {
    console.log(`skip ${p.slug} (already published)`);
    continue;
  }
  if (detail.variants.length === 0) {
    const variant = await post(
      `products/${id}/variants`,
      { sku: p.sku, name: 'Tiêu chuẩn', priceVnd: p.priceVnd, weightGrams: 250 },
      `variant ${p.slug}`,
    );
    await post(
      'inventory/adjustments',
      { variantId: variant.id, delta: p.stock, reason: 'RECEIPT', note: 'Tồn kho khởi tạo' },
      `stock ${p.slug}`,
    );
  }
  if (detail.images.length === 0) {
    const form = new FormData();
    form.set(
      'file',
      new Blob([await fs.readFile(path.join(root, 'scripts/product-assets', p.image))], {
        type: 'image/jpeg',
      }),
      p.image,
    );
    form.set('alt', p.alt);
    await must(
      await fetch(`${API}/v1/admin/products/${id}/images`, { method: 'POST', headers, body: form }),
      `image ${p.slug}`,
    );
  }
  detail = await (
    await must(await fetch(`${API}/v1/admin/products/${id}`, { headers }), 'detail')
  ).json();
  await must(
    await fetch(`${API}/v1/admin/products/${id}`, {
      method: 'PATCH',
      headers: json,
      body: JSON.stringify({ status: 'PUBLISHED', version: detail.version }),
    }),
    `publish ${p.slug}`,
  );
  console.log(`added ${p.slug}`);
}
