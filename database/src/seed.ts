import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { hatSvg, SEED_PICTURE_SIZE, type HatArt } from './art.js';
import { upsertStaff } from './users.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MEDIA_DIR = process.env.MEDIA_SEED_DIR ?? path.join(ROOT, 'apps/web/public/media');

const categories = [
  {
    slug: 'non-truyen-thong',
    name: 'Nón truyền thống',
    description: 'Nón lá đan thủ công theo kiểu cổ điển.',
  },
  { slug: 'non-hoa', name: 'Nón họa', description: 'Nón lá vẽ tay họa tiết hoa lá, phong cảnh.' },
  {
    slug: 'non-thoi-trang',
    name: 'Nón thời trang',
    description: 'Phom dáng đương đại cho phong cách hằng ngày.',
  },
  { slug: 'qua-tang-mini', name: 'Quà tặng & Mini', description: 'Nón mini xinh xắn để làm quà.' },
];

interface SeedProduct {
  slug: string;
  name: string;
  category: string;
  priceVnd: number;
  compareAtVnd?: number;
  badge?: string;
  color: string;
  style: string;
  summary: string;
  stock: number;
  art: HatArt;
  variants?: { suffix: string; name: string; priceVnd: number }[];
}

const products: SeedProduct[] = [
  {
    slug: 'non-sen-thi-tham',
    name: 'Nón Sen Thì Thầm',
    category: 'non-hoa',
    priceVnd: 590_000,
    badge: 'Bán chạy',
    color: 'pink',
    style: 'floral',
    summary: 'Họa tiết sen vẽ tay trên nền lá mềm.',
    stock: 24,
    art: { bg: '#ead9d1', accent: '#a4413a', motif: '❀', rotation: -7 },
  },
  {
    slug: 'non-moc-an-nhien',
    name: 'Nón Mộc An Nhiên',
    category: 'non-truyen-thong',
    priceVnd: 390_000,
    color: 'natural',
    style: 'minimal',
    summary: 'Màu lá tự nhiên, tối giản và nhẹ.',
    stock: 40,
    art: { bg: '#e9e3d4', accent: '#7e6548', motif: '', rotation: 5 },
    variants: [
      { suffix: 'M', name: 'Size M', priceVnd: 390_000 },
      { suffix: 'L', name: 'Size L', priceVnd: 410_000 },
    ],
  },
  {
    slug: 'non-lam-hoi-an',
    name: 'Nón Lam Hội An',
    category: 'non-hoa',
    priceVnd: 720_000,
    compareAtVnd: 790_000,
    badge: 'Mới',
    color: 'blue',
    style: 'heritage',
    summary: 'Sắc lam phố cổ, lấy cảm hứng từ đèn lồng Hội An.',
    stock: 12,
    art: { bg: '#cad9d9', accent: '#285c68', motif: '〰', rotation: -3 },
  },
  {
    slug: 'non-son-viet',
    name: 'Nón Son Việt',
    category: 'non-thoi-trang',
    priceVnd: 650_000,
    badge: 'Độc bản',
    color: 'red',
    style: 'modern',
    summary: 'Sơn đỏ bóng, phom dáng đương đại.',
    stock: 5,
    art: { bg: '#dec7b9', accent: '#a52f27', motif: '✦', rotation: 7 },
  },
  {
    slug: 'non-truc-binh-yen',
    name: 'Nón Trúc Bình Yên',
    category: 'non-truyen-thong',
    priceVnd: 460_000,
    color: 'natural',
    style: 'heritage',
    summary: 'Đan trúc mảnh, gợi nhớ làng nghề xưa.',
    stock: 18,
    art: { bg: '#dce1d1', accent: '#506346', motif: '𖥧', rotation: -5 },
  },
  {
    slug: 'non-nguyet-duong-dai',
    name: 'Nón Nguyệt Đương Đại',
    category: 'non-thoi-trang',
    priceVnd: 840_000,
    badge: 'Giới hạn',
    color: 'black',
    style: 'modern',
    summary: 'Tông đen trầm với điểm nhấn trăng khuyết.',
    stock: 3,
    art: { bg: '#d5d0c8', accent: '#242a27', motif: '◐', rotation: 4, dark: true },
  },
  {
    slug: 'non-mini-sac-viet',
    name: 'Nón Mini Sắc Việt',
    category: 'qua-tang-mini',
    priceVnd: 190_000,
    badge: 'Quà tặng',
    color: 'red',
    style: 'heritage',
    summary: 'Nón mini trang trí, món quà nhỏ đậm chất Việt.',
    stock: 60,
    art: { bg: '#ead9cb', accent: '#a83b2e', motif: '✿', rotation: -8 },
  },
  {
    slug: 'non-hong-van',
    name: 'Nón Hồng Vân',
    category: 'non-hoa',
    priceVnd: 680_000,
    color: 'pink',
    style: 'floral',
    summary: 'Mây hồng pastel vẽ tay, nhẹ nhàng nữ tính.',
    stock: 0,
    art: { bg: '#ead5db', accent: '#a54d67', motif: '❁', rotation: 6 },
  },
];

export async function seed(client: pg.Client): Promise<void> {
  await upsertStaff(
    client,
    process.env.SEED_ADMIN_EMAIL ?? 'admin@nona.local',
    process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!2026',
    'Quản trị NONA',
    'ADMIN',
  );
  await mkdir(path.join(MEDIA_DIR, 'seed'), { recursive: true });
  await client.query('BEGIN');
  try {
    await client.query(
      'TRUNCATE inventory_movements, product_images, product_variants, products, categories CASCADE',
    );
    const categoryIds = new Map<string, string>();
    for (const [index, c] of categories.entries()) {
      const { rows } = await client.query<{ id: string }>(
        'INSERT INTO categories (slug, name, description, sort_order) VALUES ($1,$2,$3,$4) RETURNING id',
        [c.slug, c.name, c.description, index],
      );
      categoryIds.set(c.slug, rows[0]!.id);
    }
    for (const [index, p] of products.entries()) {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO products (category_id, slug, name, summary, description, status, badge, color_code, style_code,
           sort_weight, seo_title, seo_description, published_at)
         VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,$7,$8,$9,$10,$11, now()) RETURNING id`,
        [
          categoryIds.get(p.category),
          p.slug,
          p.name,
          p.summary,
          `${p.summary} Mỗi chiếc nón được hoàn thiện thủ công bởi nghệ nhân Việt.`,
          p.badge ?? null,
          p.color,
          p.style,
          products.length - index,
          `${p.name} | NONA`,
          p.summary,
        ],
      );
      const productId = rows[0]!.id;
      const key = `seed/${p.slug}.svg`;
      await writeFile(path.join(MEDIA_DIR, key), hatSvg(p.art, p.slug));
      await client.query(
        'INSERT INTO product_images (product_id, object_key, alt, width, height, position) VALUES ($1,$2,$3,$4,$5,0)',
        [
          productId,
          key,
          `${p.name} — ${p.summary}`,
          SEED_PICTURE_SIZE.width,
          SEED_PICTURE_SIZE.height,
        ],
      );
      const variants = p.variants ?? [{ suffix: 'STD', name: 'Tiêu chuẩn', priceVnd: p.priceVnd }];
      for (const [vi, v] of variants.entries()) {
        const sku = `NONA-${p.slug.replace(/^non-/, '').toUpperCase()}-${v.suffix}`;
        const res = await client.query<{ id: string }>(
          `INSERT INTO product_variants (product_id, sku, name, price_vnd, compare_at_price_vnd, position, weight_grams)
           VALUES ($1,$2,$3,$4,$5,$6,250) RETURNING id`,
          [productId, sku, v.name, v.priceVnd, vi === 0 ? (p.compareAtVnd ?? null) : null, vi],
        );
        if (p.stock > 0) {
          await client.query(
            `INSERT INTO inventory_movements (variant_id, delta, reason, reference, note)
             VALUES ($1,$2,'RECEIPT','seed','Tồn kho khởi tạo')`,
            [res.rows[0]!.id, p.stock],
          );
        }
      }
    }
    // Sample contact channels for local development only; admins replace them in Admin -> Liên hệ.
    const sample = {
      floatingEnabled: true,
      headline: 'Liên hệ NONA',
      description:
        'Bạn cần tư vấn chọn nón hay thiết kế riêng? Nhắn cho chúng tôi qua kênh bạn thấy tiện nhất.',
      address: '',
      hours: '8:00 - 21:00 mỗi ngày',
      channels: [
        { id: 'zalo', kind: 'ZALO', label: 'Zalo', url: 'https://zalo.me/', enabled: true },
        {
          id: 'facebook',
          kind: 'FACEBOOK',
          label: 'Facebook',
          url: 'https://www.facebook.com/',
          enabled: true,
        },
        {
          id: 'tiktok',
          kind: 'TIKTOK',
          label: 'TikTok',
          url: 'https://www.tiktok.com/',
          enabled: true,
        },
        {
          id: 'email',
          kind: 'EMAIL',
          label: 'Gmail',
          url: 'mailto:lienhe@example.com',
          enabled: true,
        },
      ],
    };
    await client.query(
      `UPDATE site_settings SET value = $1::jsonb WHERE key = 'contact' AND jsonb_array_length(value->'channels') = 0`,
      [JSON.stringify(sample)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}
