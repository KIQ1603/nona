import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  adminSettingsSchema,
  customCatalogSchema,
  designArea,
  designSchema,
} from '@nona/contracts';
import type pg from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE } from '../src/modules/media/domain';
import type { MemoryStorage } from '../src/modules/media/infrastructure/memory-storage';
import { createCategory, createProduct } from './factories';
import { as, bootApp, browser, createUser, DEFAULT_CUSTOM, login, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
const storage = () => app.get<MemoryStorage>(OBJECT_STORAGE);
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  storage().objects.clear();
});

const staff = async (role: 'ADMIN' | 'CATALOG' | 'SUPPORT' | 'FINANCE') =>
  as(app, await login(app, (await createUser(pool, role)).email));
type Api = Awaited<ReturnType<typeof staff>>;

const STAR =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 5 L61 38 L96 38 L68 58 L78 92 L50 71 L22 92 L32 58 L4 38 L39 38Z" fill="#000"/></svg>';
const TRI =
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><path d="M150 5 L295 195 L5 195Z" fill="#c9a24b"/></svg>';
const svgFile = (s: string) => Buffer.from(s);
const png = (s: string, size?: number) =>
  sharp(Buffer.from(s), { density: 96 })
    .resize(size ? { width: size } : undefined)
    .png()
    .toBuffer();
const meta = async (buf: Buffer) => sharp(buf).metadata();

describe('charm pictures', () => {
  const up = (api: Api, buf: Buffer, name: string) =>
    api.post('/v1/admin/custom/motif-image').attach('file', buf, name);

  it('accepts SVG as well as PNG of any size, and stores a small transparent WebP that keeps its proportions', async () => {
    const api = await staff('ADMIN');
    const fromSvg = await up(api, svgFile(STAR), 'star.svg');
    expect(fromSvg.status, JSON.stringify(fromSvg.body)).toBe(201);
    expect(fromSvg.body).toMatchObject({ transparent: true });
    expect(fromSvg.body.imageKey).toMatch(/^custom\/motifs\/[0-9a-f-]{36}\.webp$/);
    const stored = storage().objects.get(fromSvg.body.imageKey)!;
    expect(stored.contentType).toBe('image/webp');
    const m = await meta(stored.body);
    expect(m).toMatchObject({ format: 'webp', hasAlpha: true });
    expect(Math.max(m.width!, m.height!)).toBe(256); // longest side fills the slot, no square padding
    expect(fromSvg.body).toMatchObject({ width: m.width, height: m.height });

    const huge = await up(api, await png(STAR, 3000), 'huge.png'); // a 3000px picture is shrunk, not refused
    expect(huge.status).toBe(201);
    const hm = await meta(storage().objects.get(huge.body.imageKey)!.body);
    expect(Math.max(hm.width!, hm.height!)).toBe(256);
    expect(storage().objects.get(huge.body.imageKey)!.body.length).toBeLessThan(40_000);
  });

  it('trims empty margins so every icon fills its slot the same way', async () => {
    const api = await staff('ADMIN');
    const padded = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><path transform="translate(150 150) scale(1)" d="M50 5 L61 38 L96 38 L68 58 L78 92 L50 71 L22 92 L32 58 L4 38 L39 38Z" fill="#000"/></svg>`;
    const a = await up(api, svgFile(padded), 'p.svg');
    const { data, info } = await sharp(storage().objects.get(a.body.imageKey)!.body)
      .raw()
      .toBuffer({ resolveWithObject: true });
    let minX = info.width,
      maxX = 0;
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[(y * info.width + x) * info.channels + 3]! > 20) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
        }
    expect(maxX - minX).toBeGreaterThan(220); // the star spans (almost) the whole 256px slot
  });

  it('warns when a picture has no transparency (a JPEG would keep its background box)', async () => {
    const api = await staff('ADMIN');
    const jpg = await sharp({
      create: { width: 600, height: 600, channels: 3, background: '#ffffff' },
    })
      .composite([{ input: await png(STAR, 300), left: 150, top: 150 }])
      .jpeg()
      .toBuffer();
    const res = await up(api, jpg, 'x.jpg');
    expect(res.status).toBe(201);
    expect(res.body.transparent).toBe(false);
  });

  it.each([
    [
      'script',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><path d="M0 0 L9 9"/></svg>',
    ],
    [
      'event handler',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><path d="M0 0 L9 9"/></svg>',
    ],
    [
      'embedded image',
      '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AAAA"/></svg>',
    ],
    [
      'external reference',
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="file:///etc/passwd"/></svg>',
    ],
    [
      'remote url()',
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="9" height="9" fill="url(http://evil.example/x)"/></svg>',
    ],
    [
      'entity bomb',
      '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "aaaa">]><svg xmlns="http://www.w3.org/2000/svg"><text>&a;</text></svg>',
    ],
    [
      'foreignObject',
      '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>hi</div></foreignObject></svg>',
    ],
  ])('refuses an SVG with %s, storing nothing', async (_label, svg) => {
    const api = await staff('ADMIN');
    const res = await up(api, svgFile(svg), 'bad.svg');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(storage().objects.size).toBe(0);
  });

  it('refuses non-images, blank pictures and huge SVG; and needs settings:write', async () => {
    const api = await staff('ADMIN');
    expect((await up(api, Buffer.from('not an image'), 'x.png')).status).toBe(400);
    expect(
      (
        await up(
          api,
          await sharp({
            create: {
              width: 300,
              height: 300,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 0 },
            },
          })
            .png()
            .toBuffer(),
          'blank.png',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await up(
          api,
          await sharp({ create: { width: 300, height: 300, channels: 3, background: '#ffffff' } })
            .png()
            .toBuffer(),
          'white.png',
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await up(
          api,
          svgFile(
            `<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0 L1 1" fill="#000"/><!--${'x'.repeat(400_000)}--></svg>`,
          ),
          'big.svg',
        )
      ).status,
    ).toBe(400);
    expect((await api.post('/v1/admin/custom/motif-image')).status).toBe(400);
    for (const role of ['CATALOG', 'SUPPORT', 'FINANCE'] as const)
      expect((await up(await staff(role), svgFile(STAR), 's.svg')).status, role).toBe(403);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/admin/custom/motif-image')
          .attach('file', svgFile(STAR), 's.svg')
      ).status,
    ).toBe(401);
  });

  it('can be saved into the options and reaches the public catalogue; bad keys and empty motifs are refused', async () => {
    const api = await staff('ADMIN');
    const { imageKey } = (await up(api, svgFile(STAR), 'star.svg')).body;
    const s = (await api.get('/v1/admin/settings')).body;
    expect(adminSettingsSchema.safeParse(s).success).toBe(true);
    const put = (motifs: object[]) =>
      api
        .patch('/v1/admin/settings/custom')
        .send({ version: s.custom.version, value: { ...DEFAULT_CUSTOM, motifs } });
    expect(
      (
        await put([
          {
            id: 'x',
            name: 'X',
            imageKey: 'custom/motifs/../../etc/passwd',
            priceVnd: 0,
          },
        ])
      ).status,
    ).toBe(400);
    expect((await put([{ id: 'x', name: 'X', priceVnd: 0 }])).status).toBe(400); // neither path nor picture
    const ok = await put([{ id: 'sao', name: 'Sao', path: null, imageKey, priceVnd: 12_000 }]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    await createProduct(pool, {
      categoryId: await createCategory(pool),
      customizable: true,
      variants: [{ price: 400_000, stock: 5 }],
    });
    const catalog = customCatalogSchema.parse(
      (await request(app.getHttpServer()).get('/v1/custom/catalog')).body,
    );
    expect(catalog.options.motifs[0]).toMatchObject({ imageKey });
    expect(catalog.mediaBase).toMatch(/^https?:\/\//);
  });
});

describe('hat pictures (per-variant product images)', () => {
  const up = (api: Api, id: string, buf: Buffer, variantId?: string, name = 'hat.png') => {
    const r = api.post(`/v1/admin/products/${id}/images`).attach('file', buf, name);
    return variantId ? r.field('variantId', variantId) : r;
  };
  const catalog = async () =>
    customCatalogSchema.parse((await request(app.getHttpServer()).get('/v1/custom/catalog')).body);

  it('attaches an SVG or raster picture to a variant, replaces it, and exposes it publicly', async () => {
    const api = await staff('CATALOG');
    const { productId, variantIds } = await createProduct(pool, {
      categoryId: await createCategory(pool),
      customizable: true,
      variants: [
        { price: 400_000, stock: 5 },
        { price: 400_000, stock: 5 },
      ],
    });
    const first = await up(api, productId, svgFile(TRI), variantIds[0], 'hat.svg');
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect(storage().objects.size).toBe(1);
    const imgs = first.body.images as { variantId: string | null; width: number }[];
    expect(imgs.find((i) => i.variantId === variantIds[0])).toBeTruthy();

    const second = await up(api, productId, await png(TRI, 800), variantIds[0]);
    expect(second.status).toBe(201);
    expect(storage().objects.size).toBe(1); // the variant's old picture was replaced and deleted
    expect(
      (second.body.images as { variantId: string | null }[]).filter((i) => i.variantId).length,
    ).toBe(1);

    const c = await catalog();
    const [v0, v1] = c.products[0]!.variants;
    expect(v0!.image).toMatchObject({ width: expect.any(Number) });
    expect(v1!.image?.url).not.toBe(v0!.image?.url); // the other variant falls back to the product picture

    // a product-level picture is the fallback for variants without their own
    expect((await up(api, productId, await png(TRI, 800))).status).toBe(201);
    const c2 = await catalog();
    expect(c2.products[0]!.variants[1]!.image).not.toBeNull();
  });

  it('cuts a flat studio background out of a hat photo and trims it to the hat', async () => {
    const api = await staff('CATALOG');
    const { productId, variantIds } = await createProduct(pool, {
      categoryId: await createCategory(pool),
      customizable: true,
      variants: [{ price: 400_000, stock: 5 }],
    });
    // pink 800x1000 backdrop with a brown hat in the middle
    const hat = await sharp({
      create: { width: 400, height: 200, channels: 3, background: { r: 120, g: 80, b: 40 } },
    })
      .png()
      .toBuffer();
    const photo = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: { r: 215, g: 197, b: 185 } },
    })
      .composite([{ input: hat, left: 200, top: 400 }])
      .png()
      .toBuffer();
    const res = await up(api, productId, photo, variantIds[0], 'photo.png');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const img = (
      res.body.images as { variantId: string | null; width: number; height: number }[]
    ).find((i) => i.variantId)!;
    expect(img.width).toBeLessThan(450); // trimmed to the hat (about 400 wide), not the 800 backdrop
    expect(img.height).toBeLessThan(250);
    const key = (
      await pool.query('SELECT object_key FROM product_images WHERE variant_id IS NOT NULL')
    ).rows[0].object_key as string;
    const raw = await sharp(storage().objects.get(key)!.body)
      .raw()
      .toBuffer({ resolveWithObject: true });
    // the first pixel is already the hat (brown), not the pink backdrop
    expect(raw.data[0]).toBeLessThan(150);
    expect(raw.data[2]).toBeLessThan(100);
  });

  it('is limited to catalog writers and validates the product, variant and file', async () => {
    const admin = await staff('ADMIN');
    const { productId, variantIds } = await createProduct(pool, {
      categoryId: await createCategory(pool),
      customizable: true,
      variants: [{ price: 400_000, stock: 5 }],
    });
    for (const role of ['SUPPORT', 'FINANCE'] as const)
      expect((await up(await staff(role), productId, await png(TRI, 800))).status, role).toBe(403);
    expect((await up(admin, randomUUID(), await png(TRI, 800))).status).toBe(404);
    expect((await up(admin, productId, await png(TRI, 800), randomUUID())).status).toBe(404);
    expect((await up(admin, productId, Buffer.from('nope'), variantIds[0])).status).toBe(400);
    expect((await up(admin, productId, await png(TRI, 120))).status).toBe(400); // too small
    expect(
      (
        await up(
          admin,
          productId,
          svgFile('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
          undefined,
          'x.svg',
        )
      ).status,
    ).toBe(400);
  });
});

describe('real sizes', () => {
  it('stores the hat width in cm, validates it and passes it to the designer catalogue', async () => {
    const api = await staff('CATALOG');
    const { productId } = await createProduct(pool, {
      categoryId: await createCategory(pool),
      customizable: true,
      variants: [{ price: 400_000, stock: 5 }],
    });
    const detail = (await api.get(`/v1/admin/products/${productId}`)).body;
    expect(detail.hatWidthCm).toBeNull();
    const patch = (hatWidthCm: number | null) =>
      api.patch(`/v1/admin/products/${productId}`).send({ hatWidthCm, version: detail.version });
    expect((await patch(2)).status).toBe(400); // implausible
    const ok = await patch(42.5);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.hatWidthCm).toBe(42.5);
    const tall = await api
      .patch(`/v1/admin/products/${productId}`)
      .send({ hatHeightCm: 18, version: ok.body.version });
    expect(tall.body.hatHeightCm).toBe(18);
    const catalog = customCatalogSchema.parse(
      (await request(app.getHttpServer()).get('/v1/custom/catalog')).body,
    );
    expect(catalog.products[0]!.hatWidthCm).toBe(42.5);
    expect(catalog.options.motifs.every((m) => m.sizeCm > 0)).toBe(true);
  });
});

describe('designs on a hat picture with picture charms', () => {
  it('prices without a colour option, renders charms on the variant picture, and snapshots the variant', async () => {
    const admin = await staff('ADMIN');
    const category = await createCategory(pool);
    const { productId, variantIds } = await createProduct(pool, {
      categoryId: category,
      customizable: true,
      variants: [{ price: 400_000, stock: 5 }],
    });
    const baseUp = await admin
      .post(`/v1/admin/products/${productId}/images`)
      .attach('file', await png(TRI, 800), 'hat.png')
      .field('variantId', variantIds[0]!);
    expect(baseUp.status).toBe(201);
    const baseImg = (
      baseUp.body.images as { variantId: string | null; width: number; height: number }[]
    ).find((i) => i.variantId === variantIds[0])!;
    const { imageKey } = (
      await admin.post('/v1/admin/custom/motif-image').attach('file', svgFile(STAR), 'star.svg')
    ).body;
    const s = (await admin.get('/v1/admin/settings')).body;
    const saved = await admin.patch('/v1/admin/settings/custom').send({
      version: s.custom.version,
      value: {
        ...DEFAULT_CUSTOM,
        motifs: [{ id: 'sao', name: 'Sao', path: null, imageKey, priceVnd: 15_000 }],
      },
    });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);

    const b = browser(app);
    const body = {
      variantId: variantIds[0],
      layers: [{ kind: 'MOTIF', motifId: 'sao', x: 0.5, y: 0.6, scale: 1, rotation: 0 }],
    };
    const d = designSchema.parse((await b.post('/v1/custom-designs').send(body)).body);
    const sub = designSchema.parse(
      (await b.post(`/v1/custom-designs/${d.id}/submit`).send({})).body,
    );
    // only the charm is charged: the hat colour is the variant's own picture
    expect(sub.latest.priceAdditionVnd).toBe(15_000);

    const preview = await b.get(`/v1/custom-designs/versions/${sub.latest.id}/preview`);
    expect(preview.status).toBe(200);
    const { data, info } = await sharp(preview.body).raw().toBuffer({ resolveWithObject: true });
    const area = designArea({ width: baseImg.width, height: baseImg.height });
    const px = Math.round(((area.left + 0.5 * area.width) / area.viewW) * info.width);
    const py = Math.round(((area.top + 0.6 * area.height) / area.viewH) * info.height);
    const at = (x: number, y: number) =>
      Array.from(
        data.subarray(
          (y * info.width + x) * info.channels,
          (y * info.width + x) * info.channels + 3,
        ),
      );
    const [r, g, bl] = at(px, py);
    expect(Math.max(r!, g!, bl!)).toBeLessThan(80); // the star is drawn at the dragged spot
    const [hr, hg, hb] = at(
      Math.round(((area.left + 0.5 * area.width) / area.viewW) * info.width),
      Math.round(((area.top + 0.9 * area.height) / area.viewH) * info.height),
    );
    expect(hr! > 150 && hg! > 120 && hb! < 120).toBe(true); // the hat picture itself (gold) is behind it

    const order = await pool.query('SELECT 1');
    expect(order.rowCount).toBe(1);
    const snap = await (
      await import('../src/modules/designs/application/designs.service')
    ).DesignsService.prototype.snapshot.call(
      app.get((await import('../src/modules/designs/application/designs.service')).DesignsService),
      pool,
      sub.latest.id,
    );
    expect(snap.hatColor).toBeNull();
    expect(snap.variantName).toBeTruthy();
    expect(snap.priceAdditionVnd).toBe(15_000);
    expect(snap.priceLines.map((l: { amountVnd: number }) => l.amountVnd)).toEqual([15_000]);
  });
});
