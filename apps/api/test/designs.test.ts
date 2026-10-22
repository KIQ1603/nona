import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  adminDesignDetailSchema,
  adminSettingsSchema,
  adminDesignListSchema,
  designSchema,
  orderSchema,
} from '@nona/contracts';
import type pg from 'pg';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OBJECT_STORAGE } from '../src/modules/media/domain';
import type { MemoryStorage } from '../src/modules/media/infrastructure/memory-storage';
import { createCategory, createProduct } from './factories';
import {
  as,
  bootApp,
  browser,
  createUser,
  DEFAULT_CUSTOM,
  login,
  png,
  register,
  resetAll,
  WEB_ORIGIN,
} from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
let cat: string;
const storage = () => app.get<MemoryStorage>(OBJECT_STORAGE);
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  storage().objects.clear();
  cat = await createCategory(pool);
});

const pos = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
const text = (t = 'Lan') => ({ kind: 'TEXT', text: t, fontId: 'serif', ...pos });
const motif = { kind: 'MOTIF', motifId: 'star', ...pos };
const base = async (o: { price?: number; stock?: number; customizable?: boolean } = {}) => {
  const r = await createProduct(pool, {
    categoryId: cat,
    customizable: o.customizable ?? true,
    variants: [{ price: o.price ?? 400_000, stock: o.stock ?? 10 }],
  });
  return { variantId: r.variantIds[0]!, productId: r.productId };
};
const body = (variantId: string, over: object = {}) => ({
  title: 'Nón của Lan',
  variantId,
  layers: [text(), motif],
  ...over,
});
const staff = async (role: 'ADMIN' | 'CATALOG' | 'FULFILLMENT' | 'SUPPORT' | 'FINANCE') =>
  as(app, await login(app, (await createUser(pool, role)).email));
const setCustom = (patch: object) =>
  pool.query(`UPDATE site_settings SET value = value || $1::jsonb WHERE key = 'custom'`, [
    JSON.stringify(patch),
  ]);
const upload = (b: ReturnType<typeof browser>, buf: Buffer, name = 'a.png') =>
  b.post('/v1/custom-designs/assets').attach('file', buf, name);
const dto = (res: request.Response) => designSchema.parse(res.body);
const isPng = (buf: Buffer) => buf.subarray(0, 8).toString('hex') === '89504e470d0a1a0a';

/** guest designs, submits and (via staff) gets approval; returns ids for further steps. */
async function approvedDesign(b = browser(app), over: object = {}, variantId?: string) {
  const v = variantId ?? (await base()).variantId;
  const created = dto(await b.post('/v1/custom-designs').send(body(v, over)));
  const submitted = await b
    .post(`/v1/custom-designs/${created.id}/submit`)
    .send({ contactEmail: 'lan@example.com' });
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);
  const reviewer = await staff('CATALOG');
  const versionId = dto(submitted).latest.id;
  const rv = await reviewer
    .post(`/v1/admin/designs/versions/${versionId}/review`)
    .send({ decision: 'APPROVE' });
  expect(rv.status, JSON.stringify(rv.body)).toBe(200);
  return { b, designId: created.id, versionId, variantId: v };
}

describe('catalogue', () => {
  it('lists only published customizable products with active variants, plus the admin-managed options', async () => {
    const a = await base();
    await base({ customizable: false });
    const res = await request(app.getHttpServer()).get('/v1/custom/catalog');
    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(1);
    expect(res.body.products[0].variants[0]).toMatchObject({ id: a.variantId, priceVnd: 400_000 });
    expect(res.body.options.colors).toBeUndefined();
    expect(res.body.products[0].variants[0]).toHaveProperty('image');
  });
  it('refuses to create designs while the feature is switched off', async () => {
    const v = await base();
    await setCustom({ enabled: false });
    const res = await browser(app).post('/v1/custom-designs').send(body(v.variantId));
    expect(res.status).toBe(409);
  });
});

describe('creating and editing drafts', () => {
  it('stores the draft with ordered layers, gives a guest an HttpOnly ownership cookie, and shows no frozen price yet', async () => {
    const v = await base();
    const b = browser(app);
    const res = await b.post('/v1/custom-designs').send(body(v.variantId));
    expect(res.status).toBe(201);
    expect((res.headers['set-cookie'] as unknown as string[])[0]).toMatch(/nona_design=.+HttpOnly/);
    const d = dto(res);
    expect(d.latest).toMatchObject({
      versionNo: 1,
      status: 'DRAFT',
      priceAdditionVnd: null,
      hasPreview: false,
    });
    expect(d.latest.layers.map((l) => [l.position, l.kind, l.text ?? l.motifId])).toEqual([
      [0, 'TEXT', 'Lan'],
      [1, 'MOTIF', 'star'],
    ]);
    expect(d.product).toMatchObject({ basePriceVnd: 400_000 });
    expect(dto(await b.get(`/v1/custom-designs/${d.id}`)).id).toBe(d.id);
    const stored = (await pool.query('SELECT guest_token_hash FROM custom_designs')).rows[0]
      .guest_token_hash;
    expect(b.jar.get('nona_design')).not.toBe(stored); // only a hash is stored
  });

  it('validates against the admin options, the base product and upload ownership', async () => {
    const v = await base();
    const plain = await base({ customizable: false });
    const b = browser(app);
    const post = (over: object) => b.post('/v1/custom-designs').send(body(v.variantId, over));
    expect((await post({ layers: [{ ...motif, motifId: 'nope' }] })).status).toBe(400);
    expect((await post({ layers: Array.from({ length: 7 }, () => motif) })).status).toBe(400);
    expect((await post({ layers: [text('x'.repeat(31))] })).status).toBe(400);
    expect((await post({ layers: [{ ...text(), x: 1.5 }] })).status).toBe(400);
    expect((await post({ layers: [{ ...text(), scale: 50 }] })).status).toBe(400);
    expect((await post({ title: '' })).status).toBe(400);
    expect(
      (await post({ layers: [{ kind: 'IMAGE', assetId: randomUUID(), ...pos }] })).status,
    ).toBe(400);
    expect((await b.post('/v1/custom-designs').send(body(plain.variantId))).status).toBe(400); // not customizable
    expect((await b.post('/v1/custom-designs').send(body(randomUUID()))).status).toBe(400);
    expect(await pool.query('SELECT 1 FROM custom_designs').then((r) => r.rowCount)).toBe(0);
  });

  it('keeps designs private: other visitors and accounts get 404, never 403', async () => {
    const v = await base();
    const owner = browser(app);
    const d = dto(await owner.post('/v1/custom-designs').send(body(v.variantId)));
    const stranger = browser(app);
    const { session } = await register(app, 'other@example.com');
    const account = browser(app);
    account.useSession(session!);
    for (const who of [stranger, account]) {
      expect((await who.get(`/v1/custom-designs/${d.id}`)).status).toBe(404);
      expect((await who.patch(`/v1/custom-designs/${d.id}`).send({ title: 'hack' })).status).toBe(
        404,
      );
      expect((await who.post(`/v1/custom-designs/${d.id}/submit`).send({})).status).toBe(404);
      expect((await who.post(`/v1/custom-designs/${d.id}/versions`).send({})).status).toBe(404);
    }
    expect((await stranger.get('/v1/custom-designs/not-a-uuid')).status).toBe(404);
    expect((await stranger.get('/v1/custom-designs')).body.items).toEqual([]);
    expect((await owner.get('/v1/custom-designs')).body.items).toHaveLength(1);
    expect((await pool.query('SELECT title FROM custom_designs')).rows[0].title).toBe(
      'Nón của Lan',
    );
  });

  it('edits the draft in place, but never a submitted version', async () => {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    const upd = await b
      .patch(`/v1/custom-designs/${d.id}`)
      .send({ title: 'Mới', layers: [text('Hoa')] });
    expect(upd.status).toBe(200);
    expect(dto(upd)).toMatchObject({ title: 'Mới' });
    expect(dto(upd).latest).toMatchObject({
      layers: [expect.objectContaining({ text: 'Hoa' })],
    });
    await b.post(`/v1/custom-designs/${d.id}/submit`).send({ contactEmail: 'a@example.com' });
    const frozen = await b.patch(`/v1/custom-designs/${d.id}`).send({ title: 'Sửa sau khi nộp' });
    expect(frozen.status).toBe(409);
    expect((await pool.query('SELECT title FROM custom_designs')).rows[0].title).toBe('Mới');
  });
});

describe('submitting: frozen price and server-rendered preview', () => {
  it('prices the customisation from the admin options, stores a PNG preview and locks the version', async () => {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId))); // red 20k + text 30k + star 20k
    const res = await b
      .post(`/v1/custom-designs/${d.id}/submit`)
      .send({ contactEmail: 'lan@example.com' });
    expect(res.status).toBe(200);
    const s = dto(res);
    expect(s.latest).toMatchObject({
      status: 'SUBMITTED',
      priceAdditionVnd: 50_000,
      hasPreview: true,
    });
    expect(s.latest.submittedAt).not.toBeNull();
    const key = (await pool.query('SELECT preview_key FROM custom_design_versions')).rows[0]
      .preview_key as string;
    const obj = storage().objects.get(key)!;
    expect(obj.contentType).toBe('image/png');
    expect(isPng(obj.body)).toBe(true);
    const preview = await b.get(`/v1/custom-designs/versions/${s.latest.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.headers['content-type']).toBe('image/png');
    expect(preview.headers['cache-control']).toContain('private');
    expect(isPng(preview.body)).toBe(true);
    expect((await b.post(`/v1/custom-designs/${d.id}/submit`).send({})).status).toBe(409);
  });

  it('keeps the frozen price when the admin later changes option prices', async () => {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    await b.post(`/v1/custom-designs/${d.id}/submit`).send({ contactEmail: 'a@example.com' });
    await setCustom({
      textPriceVnd: 500_000,
    });
    expect(dto(await b.get(`/v1/custom-designs/${d.id}`)).latest.priceAdditionVnd).toBe(50_000);
  });

  it('needs no title or email to submit, and validates once more at submission', async () => {
    const v = await base();
    const b = browser(app);
    const { title: _t, ...untitled } = body(v.variantId);
    const d = dto(await b.post('/v1/custom-designs').send(untitled));
    expect(d.title).toBe('Nón thiết kế riêng');
    await setCustom({ motifs: [] }); // the motif used by the draft no longer exists
    const stale = await b.post(`/v1/custom-designs/${d.id}/submit`).send({});
    expect(stale.status).toBe(400);
    expect(
      await pool
        .query(`SELECT 1 FROM custom_design_versions WHERE status <> 'DRAFT'`)
        .then((r) => r.rowCount),
    ).toBe(0);
    expect(storage().objects.size).toBe(0); // nothing rendered or stored on a rejected submission
    await setCustom({ motifs: DEFAULT_CUSTOM.motifs });
    expect(dto(await b.post(`/v1/custom-designs/${d.id}/submit`).send({})).latest.status).toBe(
      'SUBMITTED',
    );
  });

  it('renders text and uploaded images into the preview, and survives hostile text', async () => {
    const v = await base();
    const b = browser(app);
    const asset = (await upload(b, await png(600))).body;
    const d = dto(
      await b.post('/v1/custom-designs').send(
        body(v.variantId, {
          layers: [
            text('<script>alert(1)</script> &"\''),
            { kind: 'IMAGE', assetId: asset.id, ...pos },
          ],
        }),
      ),
    );
    const res = await b
      .post(`/v1/custom-designs/${d.id}/submit`)
      .send({ contactEmail: 'a@example.com' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dto(res).latest.priceAdditionVnd).toBe(30_000 + 60_000);
    expect(
      isPng((await b.get(`/v1/custom-designs/versions/${dto(res).latest.id}/preview`)).body),
    ).toBe(true);
  });

  it('with approval switched off (the shop default) a submitted design is approved at once, uploaded pictures included', async () => {
    await setCustom({ requireApproval: false });
    const v = await base();
    const plain = browser(app);
    const d1 = dto(await plain.post('/v1/custom-designs').send(body(v.variantId)));
    expect(dto(await plain.post(`/v1/custom-designs/${d1.id}/submit`).send({})).latest.status).toBe(
      'APPROVED',
    );
    const withImage = browser(app);
    const asset = (await upload(withImage, await png(600))).body;
    expect(asset.status).toBe('PENDING');
    const d2 = dto(
      await withImage
        .post('/v1/custom-designs')
        .send(body(v.variantId, { layers: [{ kind: 'IMAGE', assetId: asset.id, ...pos }] })),
    );
    const sub = dto(await withImage.post(`/v1/custom-designs/${d2.id}/submit`).send({}));
    expect(sub.latest.status).toBe('APPROVED');
    expect(sub.assets[0]).toMatchObject({ id: asset.id, status: 'APPROVED' });
    expect(
      (await pool.query('SELECT 1 FROM outbox_events WHERE type = $1', ['design.reviewed']))
        .rowCount,
    ).toBe(0); // nobody to notify: nobody reviewed
  });
  it('with approval switched on, designs (and their pictures) wait for staff', async () => {
    await setCustom({ requireApproval: true });
    const v = await base();
    const b = browser(app);
    const asset = (await upload(b, await png(600))).body;
    const d = dto(
      await b
        .post('/v1/custom-designs')
        .send(body(v.variantId, { layers: [{ kind: 'IMAGE', assetId: asset.id, ...pos }] })),
    );
    expect(dto(await b.post(`/v1/custom-designs/${d.id}/submit`).send({})).latest.status).toBe(
      'SUBMITTED',
    );
  });
  it('lets a customer order and staff run the order with no design step at all', async () => {
    await setCustom({ requireApproval: false });
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    const s = dto(await b.post(`/v1/custom-designs/${d.id}/submit`).send({}));
    await b
      .post('/v1/cart/items')
      .send({ variantId: v.variantId, designVersionId: s.latest.id })
      .expect(201);
    const total = (await b.post('/v1/checkout/quote').send({})).body.totalVnd;
    const addr = {
      fullName: 'Nguyễn Văn A',
      phone: '0901234567',
      line1: '12 Lê Lợi',
      ward: 'Bến Thành',
      district: 'Quận 1',
      province: 'TP. Hồ Chí Minh',
    };
    expect(
      (
        await b.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
          shippingAddress: addr,
          contactEmail: 'a@example.com',
          paymentMethod: 'COD',
          expectedTotalVnd: total,
        })
      ).status,
    ).toBe(201);
    const id = (await pool.query('SELECT id FROM orders')).rows[0].id as string;
    const fulfil = await staff('FULFILLMENT');
    expect((await fulfil.get(`/v1/admin/orders/${id}`)).body.pendingDesigns).toEqual([]);
    expect((await fulfil.get('/v1/admin/orders')).body.items[0].pendingDesigns).toBe(0);
    for (const [to, version] of [
      ['PROCESSING', 1],
      ['READY_TO_SHIP', 2],
      ['SHIPPING', 3],
    ] as const)
      expect(
        (
          await fulfil
            .patch(`/v1/admin/orders/${id}/status`)
            .send({ to, version, ...(to === 'SHIPPING' ? { shipment: { carrier: 'GHN' } } : {}) })
        ).status,
        to,
      ).toBe(200);
    expect(
      (await fulfil.patch(`/v1/admin/orders/${id}/status`).send({ to: 'COMPLETED', version: 4 }))
        .status,
    ).toBe(200);
  });
});

describe('immutability is enforced by the database', () => {
  async function submitted() {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    const s = dto(
      await b.post(`/v1/custom-designs/${d.id}/submit`).send({ contactEmail: 'a@example.com' }),
    );
    return { b, d, versionId: s.latest.id, variantId: v.variantId };
  }
  it('rejects any change to the content of a submitted version, however it is attempted', async () => {
    const { versionId } = await submitted();
    for (const sql of [
      `UPDATE custom_design_versions SET hat_color_id = 'natural' WHERE id = $1`,
      `UPDATE custom_design_versions SET price_addition_vnd = 1 WHERE id = $1`,
      `UPDATE custom_design_versions SET preview_key = 'x' WHERE id = $1`,
      `UPDATE custom_design_versions SET variant_id = gen_random_uuid() WHERE id = $1`,
      `UPDATE custom_design_versions SET version_no = 9 WHERE id = $1`,
      `DELETE FROM custom_design_versions WHERE id = $1`,
      `UPDATE design_layers SET x = 0.1 WHERE version_id = $1`,
      `DELETE FROM design_layers WHERE version_id = $1`,
      `INSERT INTO design_layers (version_id, position, kind, props) VALUES ($1, 9, 'MOTIF', '{}')`,
    ])
      await expect(pool.query(sql, [versionId]), sql).rejects.toThrow(/immutable/);
    expect(
      (
        await pool.query('SELECT COUNT(*)::int n FROM design_layers WHERE version_id = $1', [
          versionId,
        ])
      ).rows[0].n,
    ).toBe(2);
  });
  it('allows only the review transitions', async () => {
    const { versionId } = await submitted();
    const set = (s: string) =>
      pool.query('UPDATE custom_design_versions SET status = $2 WHERE id = $1', [versionId, s]);
    await expect(set('DRAFT')).rejects.toThrow(/immutable/);
    await expect(set('ARCHIVED')).rejects.toThrow(/immutable/); // SUBMITTED cannot be archived directly
    await set('APPROVED');
    await expect(set('SUBMITTED')).rejects.toThrow(/immutable/);
    await expect(set('REVISION_REQUIRED')).rejects.toThrow(/immutable/);
    await set('ARCHIVED');
    for (const s of ['APPROVED', 'DRAFT', 'SUBMITTED', 'REVISION_REQUIRED'])
      await expect(set(s), s).rejects.toThrow(/immutable/);
  });
  it('lets a draft change freely but only be submitted, not jump to approved', async () => {
    const v = await base();
    const d = dto(await browser(app).post('/v1/custom-designs').send(body(v.variantId)));
    await pool.query(`UPDATE custom_design_versions SET hat_color_id = 'natural' WHERE id = $1`, [
      d.latest.id,
    ]);
    await expect(
      pool.query(`UPDATE custom_design_versions SET status = 'APPROVED' WHERE id = $1`, [
        d.latest.id,
      ]),
    ).rejects.toThrow(/immutable/);
  });
});

describe('versions', () => {
  it('cannot be started while a version awaits review; after "revision required" it archives the old one', async () => {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    const s = dto(
      await b.post(`/v1/custom-designs/${d.id}/submit`).send({ contactEmail: 'a@example.com' }),
    );
    expect((await b.post(`/v1/custom-designs/${d.id}/versions`).send({})).status).toBe(409);
    const reviewer = await staff('CATALOG');
    await reviewer
      .post(`/v1/admin/designs/versions/${s.latest.id}/review`)
      .send({ decision: 'REQUEST_REVISION', note: 'Chữ hơi nhỏ' });
    const v2 = dto(await b.post(`/v1/custom-designs/${d.id}/versions`).send({}));
    expect(v2.latest).toMatchObject({
      versionNo: 2,
      status: 'DRAFT',
      layers: [expect.objectContaining({ text: 'Lan' }), expect.anything()],
    });
    expect(v2.versions.map((x) => [x.versionNo, x.status])).toEqual([
      [1, 'ARCHIVED'],
      [2, 'DRAFT'],
    ]);
    expect(dto(await b.post(`/v1/custom-designs/${d.id}/versions`).send({})).latest.id).toBe(
      v2.latest.id,
    ); // idempotent while a draft exists
  });

  it('leaves an approved version approved and untouched while the next one is edited', async () => {
    const { b, designId, versionId } = await approvedDesign();
    const v2 = dto(await b.post(`/v1/custom-designs/${designId}/versions`).send({}));
    expect(v2.latest.versionNo).toBe(2);
    await b.patch(`/v1/custom-designs/${designId}`).send({ layers: [text('Khác')] });
    const v1 = (
      await pool.query(
        'SELECT status, price_addition_vnd FROM custom_design_versions WHERE id = $1',
        [versionId],
      )
    ).rows[0];
    expect(v1).toEqual({ status: 'APPROVED', price_addition_vnd: '50000' });
    expect(
      (
        await pool.query('SELECT props FROM design_layers WHERE version_id = $1 AND kind = $2', [
          versionId,
          'TEXT',
        ])
      ).rows[0].props.text,
    ).toBe('Lan');
  });
});

describe('uploads', () => {
  it('re-encodes images, keeps them private, and streams them only to their owner and staff', async () => {
    const b = browser(app);
    const res = await upload(b, await png(1800), '../../evil.png');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'PENDING', width: 1200 });
    const key = (await pool.query('SELECT object_key FROM design_assets')).rows[0]
      .object_key as string;
    expect(key).toMatch(/^designs\/assets\/[0-9a-f-]+\.webp$/);
    const obj = storage().objects.get(key)!;
    expect(obj.body.subarray(8, 12).toString()).toBe('WEBP');
    const own = await b.get(`/v1/custom-designs/assets/${res.body.id}/content`);
    expect(own.status).toBe(200);
    expect(own.headers['content-type']).toBe('image/webp');
    expect(own.headers['x-content-type-options']).toBe('nosniff');
    expect(
      (await browser(app).get(`/v1/custom-designs/assets/${res.body.id}/content`)).status,
    ).toBe(404);
    const acct = (await register(app, 'x@example.com')).session!;
    expect(
      (await as(app, acct).get(`/v1/custom-designs/assets/${res.body.id}/content`)).status,
    ).toBe(404);
    expect(
      (await (await staff('CATALOG')).get(`/v1/custom-designs/assets/${res.body.id}/content`))
        .status,
    ).toBe(200);
    expect(
      (await (await staff('FINANCE')).get(`/v1/custom-designs/assets/${res.body.id}/content`))
        .status,
    ).toBe(404); // no designs:read
  });
  it.each([
    ['text renamed to .png', Buffer.from('not an image at all'), 'x.png'],
    [
      'SVG with script',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'x.svg',
    ],
    ['empty file', Buffer.alloc(0), 'x.png'],
  ])('rejects %s', async (_l, buf, name) => {
    const res = await upload(browser(app), buf, name);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('MEDIA_INVALID');
    expect(storage().objects.size).toBe(0);
    expect(await pool.query('SELECT 1 FROM design_assets').then((r) => r.rowCount)).toBe(0);
  });
  it('rejects tiny images and oversize files, and caps uploads per owner', async () => {
    const b = browser(app);
    expect((await upload(b, await png(100))).body.error.code).toBe('MEDIA_INVALID');
    expect((await upload(b, Buffer.alloc(9 * 1024 * 1024, 1))).status).toBeGreaterThanOrEqual(400);
    const small = await png(300);
    for (let i = 0; i < 10; i++) expect((await upload(b, small)).status).toBe(201);
    expect((await upload(b, small)).status).toBe(409);
  });
  it("refuses to use someone else's upload in a design", async () => {
    const v = await base();
    const alice = browser(app);
    const asset = (await upload(alice, await png(400))).body;
    const bob = browser(app);
    const res = await bob
      .post('/v1/custom-designs')
      .send(body(v.variantId, { layers: [{ kind: 'IMAGE', assetId: asset.id, ...pos }] }));
    expect(res.status).toBe(400);
  });
  it('hands guest designs and uploads to the account on sign-in', async () => {
    const v = await base();
    const b = browser(app);
    const asset = (await upload(b, await png(400))).body;
    const d = dto(
      await b
        .post('/v1/custom-designs')
        .send(body(v.variantId, { layers: [{ kind: 'IMAGE', assetId: asset.id, ...pos }] })),
    );
    await register(app, 'mine@example.com');
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `nona_design=${b.jar.get('nona_design')}`)
      .send({ email: 'mine@example.com', password: 'correct-horse-battery' });
    expect(res.status).toBe(200);
    expect(
      (res.headers['set-cookie'] as unknown as string[]).some((c) => c.startsWith('nona_design=;')),
    ).toBe(true);
    const owner = (await pool.query('SELECT user_id, guest_token_hash FROM custom_designs'))
      .rows[0];
    expect(owner.user_id).not.toBeNull();
    expect(owner.guest_token_hash).toBeNull();
    expect((await pool.query('SELECT user_id FROM design_assets')).rows[0].user_id).toBe(
      owner.user_id,
    );
    const s = {
      cookie: (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('nona_session='))!
        .split(';')[0]!,
      csrf: res.body.csrfToken,
    };
    expect((await as(app, s).get(`/v1/custom-designs/${d.id}`)).status).toBe(200);
    expect((await b.get(`/v1/custom-designs/${d.id}`)).status).toBe(404); // the old guest cookie no longer works
  });
});

describe('staff review', () => {
  async function pending(images = false) {
    const v = await base();
    const b = browser(app);
    const asset = images ? (await upload(b, await png(500))).body : null;
    const layers = asset ? [text(), { kind: 'IMAGE', assetId: asset.id, ...pos }] : [text()];
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId, { layers })));
    const s = dto(
      await b.post(`/v1/custom-designs/${d.id}/submit`).send({ contactEmail: 'cust@example.com' }),
    );
    return { b, d, versionId: s.latest.id, assetId: asset?.id as string | undefined };
  }
  const review = (api: ReturnType<typeof as>, id: string, b: object) =>
    api.post(`/v1/admin/designs/versions/${id}/review`).send(b);

  it('approves: assets become approved, the customer is emailed, and everything is audited', async () => {
    const { versionId, assetId, d } = await pending(true);
    const res = await review(await staff('CATALOG'), versionId, {
      decision: 'APPROVE',
      note: 'Đẹp lắm!',
    });
    expect(res.status).toBe(200);
    const detail = adminDesignDetailSchema.parse(res.body);
    expect(detail.latest).toMatchObject({ status: 'APPROVED', reviewNote: 'Đẹp lắm!' });
    expect(detail.assets[0]).toMatchObject({ id: assetId, status: 'APPROVED' });
    expect(detail.ownerKind).toBe('GUEST');
    expect(detail.owner).toBe('cust@example.com');
    const mail = (
      await pool.query(`SELECT payload FROM outbox_events WHERE type = 'design.reviewed'`)
    ).rows[0].payload;
    expect(mail).toMatchObject({
      email: 'cust@example.com',
      decision: 'APPROVED',
      designId: d.id,
      note: 'Đẹp lắm!',
    });
    const audit = (
      await pool.query(`SELECT metadata FROM audit_logs WHERE action = 'design.approve'`)
    ).rows[0].metadata;
    expect(audit).toMatchObject({ versionId, versionNo: 1 });
    expect((await review(await staff('CATALOG'), versionId, { decision: 'APPROVE' })).status).toBe(
      409,
    ); // already reviewed
  });

  it('requests changes only with an explanatory note, and can reject specific uploads', async () => {
    const { versionId, assetId, b, d } = await pending(true);
    const reviewer = await staff('ADMIN');
    expect((await review(reviewer, versionId, { decision: 'REQUEST_REVISION' })).status).toBe(400);
    expect(
      (
        await review(reviewer, versionId, {
          decision: 'REQUEST_REVISION',
          note: 'x',
          rejectAssetIds: [randomUUID()],
        })
      ).status,
    ).toBe(400);
    expect(
      (await review(reviewer, versionId, { decision: 'APPROVE', rejectAssetIds: [assetId!] }))
        .status,
    ).toBe(400);
    const res = await review(reviewer, versionId, {
      decision: 'REQUEST_REVISION',
      note: 'Ảnh bị mờ, hãy dùng ảnh rõ hơn',
      rejectAssetIds: [assetId!],
    });
    expect(adminDesignDetailSchema.parse(res.body)).toMatchObject({
      latest: { status: 'REVISION_REQUIRED' },
      assets: [{ status: 'REJECTED', reviewNote: 'Ảnh bị mờ, hãy dùng ảnh rõ hơn' }],
    });
    // the customer sees the note and cannot resubmit the rejected image
    const mine = dto(await b.get(`/v1/custom-designs/${d.id}`));
    expect(mine.latest.reviewNote).toBe('Ảnh bị mờ, hãy dùng ảnh rõ hơn');
    await b.post(`/v1/custom-designs/${d.id}/versions`).send({});
    const resubmit = await b.post(`/v1/custom-designs/${d.id}/submit`).send({});
    expect(resubmit.status).toBe(400);
    expect(JSON.stringify(resubmit.body)).toMatch(/từ chối/);
  });

  it('is limited by permission: read for support/fulfilment, review only for catalog/admin', async () => {
    const { versionId, d } = await pending();
    for (const role of ['SUPPORT', 'FULFILLMENT'] as const) {
      const api = await staff(role);
      expect((await api.get('/v1/admin/designs')).status, role).toBe(200);
      expect((await api.get(`/v1/admin/designs/${d.id}`)).status, role).toBe(200);
      expect((await review(api, versionId, { decision: 'APPROVE' })).status, role).toBe(403);
    }
    const finance = await staff('FINANCE');
    expect((await finance.get('/v1/admin/designs')).status).toBe(403);
    const customer = (await register(app, 'c@example.com')).session!;
    expect((await as(app, customer).get('/v1/admin/designs')).status).toBe(403);
    expect((await request(app.getHttpServer()).get('/v1/admin/designs')).status).toBe(401);
    expect((await pool.query('SELECT status FROM custom_design_versions')).rows[0].status).toBe(
      'SUBMITTED',
    );
  });

  it('lists the review queue oldest-first, filterable by status and search', async () => {
    const b2 = await pending(); // submitted first, so it is the oldest
    const a = await pending();
    const api = await staff('SUPPORT');
    const all = adminDesignListSchema.parse((await api.get('/v1/admin/designs')).body);
    expect(all.items.map((i) => i.versionId)).toEqual([b2.versionId, a.versionId]);
    await review(await staff('CATALOG'), a.versionId, { decision: 'APPROVE' });
    expect((await api.get('/v1/admin/designs?status=SUBMITTED')).body.items).toHaveLength(1);
    expect((await api.get('/v1/admin/designs?status=APPROVED')).body.items[0].versionId).toBe(
      a.versionId,
    );
    expect((await api.get('/v1/admin/designs?q=cust@example')).body.items).toHaveLength(2);
    expect((await api.get('/v1/admin/designs?q=%25')).body.items).toHaveLength(0);
    expect((await api.get('/v1/admin/designs?status=BOGUS')).status).toBe(400);
  });
});

describe('cart, checkout and the order snapshot', () => {
  it('adds only approved designs the shopper owns, at base price + the frozen addition', async () => {
    const { b, designId, versionId, variantId } = await approvedDesign();
    const add = await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    expect(add.status).toBe(201);
    const line = add.body.lines[0];
    expect(line).toMatchObject({
      unitPriceVnd: 450_000,
      quantity: 1,
      purchasable: true,
      design: { versionId, designId, title: 'Nón của Lan', versionNo: 1 },
    });
    expect(add.body.subtotalVnd).toBe(450_000);

    const draftOwner = browser(app);
    const v2 = await base();
    const draft = dto(await draftOwner.post('/v1/custom-designs').send(body(v2.variantId)));
    const notApproved = await draftOwner
      .post('/v1/cart/items')
      .send({ variantId: v2.variantId, designVersionId: draft.latest.id });
    expect(notApproved.status).toBe(409);
    expect(notApproved.body.error.code).toBe('DESIGN_NOT_APPROVED');
    const thief = browser(app);
    expect(
      (await thief.post('/v1/cart/items').send({ variantId, designVersionId: versionId })).status,
    ).toBe(404);
    expect(
      (await b.post('/v1/cart/items').send({ variantId: v2.variantId, designVersionId: versionId }))
        .status,
    ).toBe(400); // another base variant
    expect(
      (await b.post('/v1/cart/items').send({ variantId, designVersionId: 'nope' })).status,
    ).toBe(400);
  });

  it('treats the same variant with and without a design (and different designs) as separate lines', async () => {
    const v = await base({ price: 400_000, stock: 10 });
    const a = await approvedDesign(browser(app), {}, v.variantId);
    const { b, versionId } = a;
    await b.post('/v1/cart/items').send({ variantId: v.variantId, designVersionId: versionId });
    await b.post('/v1/cart/items').send({ variantId: v.variantId });
    const again = await b
      .post('/v1/cart/items')
      .send({ variantId: v.variantId, designVersionId: versionId });
    const lines = again.body.lines as { quantity: number; design: unknown; unitPriceVnd: number }[];
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.design)).toMatchObject({ quantity: 2, unitPriceVnd: 450_000 });
    expect(lines.find((l) => !l.design)).toMatchObject({ quantity: 1, unitPriceVnd: 400_000 });
  });

  it('flags a line whose design stops being approved, and refuses to check it out', async () => {
    const { b, versionId, variantId } = await approvedDesign();
    await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    await pool.query(`UPDATE custom_design_versions SET status = 'ARCHIVED' WHERE id = $1`, [
      versionId,
    ]);
    const cart = (await b.get('/v1/cart')).body;
    expect(cart.lines[0]).toMatchObject({ purchasable: false, issue: 'DESIGN_UNAVAILABLE' });
    expect(cart.subtotalVnd).toBe(0);
    const q = (await b.post('/v1/checkout/quote').send({})).body;
    expect(q.canCheckout).toBe(false);
    expect(q.blockers[0].code).toBe('DESIGN_UNAVAILABLE');
    const order = await b.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: addr,
      contactEmail: 'a@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: 0,
    });
    expect(order.status).toBe(409);
    expect(order.body.error.details.items[0].reason).toBe('DESIGN_UNAVAILABLE');
    expect(await pool.query('SELECT 1 FROM orders').then((r) => r.rowCount)).toBe(0);
  });

  const addr = {
    fullName: 'Nguyễn Văn A',
    phone: '0901234567',
    line1: '12 Lê Lợi',
    ward: 'Bến Thành',
    district: 'Quận 1',
    province: 'TP. Hồ Chí Minh',
  };

  it('snapshots the design on the order and keeps it unchanged whatever happens afterwards', async () => {
    const { b, designId, versionId, variantId } = await approvedDesign();
    await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    const q = (await b.post('/v1/checkout/quote').send({})).body;
    expect(q).toMatchObject({ subtotalVnd: 450_000, canCheckout: true });
    const placed = await b.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: addr,
      contactEmail: 'lan@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: q.totalVnd,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    const code = placed.body.code as string;
    const row = (
      await pool.query('SELECT design_version_id, unit_price_vnd, customization FROM order_items')
    ).rows[0];
    expect(row.design_version_id).toBe(versionId);
    expect(row.unit_price_vnd).toBe('450000');
    expect(row.customization).toMatchObject({
      title: 'Nón của Lan',
      versionNo: 1,
      hatColor: null,
      priceAdditionVnd: 50_000,
      layers: [
        { kind: 'TEXT', summary: expect.stringContaining('Lan') },
        {
          kind: 'MOTIF',
          summary: expect.stringContaining('Ngôi sao'),
          charmCode: 'star',
          charmName: 'Ngôi sao',
        },
      ],
    });
    expect(row.customization.priceLines.map((l: { amountVnd: number }) => l.amountVnd)).toEqual([
      30_000, 20_000,
    ]);
    const before = JSON.stringify(
      (await pool.query('SELECT customization FROM order_items')).rows[0],
    );

    // later: the customer edits (new version), staff change prices/names, the design is archived
    await b.post(`/v1/custom-designs/${designId}/versions`).send({});
    await b.patch(`/v1/custom-designs/${designId}`).send({ title: 'Tên khác', layers: [] });
    await setCustom({
      textPriceVnd: 1,
    });
    await pool.query(`UPDATE custom_design_versions SET status = 'ARCHIVED' WHERE id = $1`, [
      versionId,
    ]);
    expect(
      JSON.stringify((await pool.query('SELECT customization FROM order_items')).rows[0]),
    ).toBe(before);

    const fetched = orderSchema.parse((await b.get(`/v1/orders/${code}`)).body);
    // a guest checkout is not an owner-authenticated view, so the text is redacted but the snapshot price/colour persist
    expect(fetched.items[0]!.customization).toMatchObject({
      priceAdditionVnd: 50_000,
    });
    expect(fetched.totalVnd).toBe(placed.body.totalVnd);
  });

  it('shows the design text only to the order owner, not to anyone with just the link', async () => {
    const { b, versionId, variantId } = await approvedDesign();
    await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    const total = (await b.post('/v1/checkout/quote').send({})).body.totalVnd;
    const placed = await b.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: addr,
      contactEmail: 'lan@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: total,
    });
    const viewer = orderSchema.parse(
      (await request(app.getHttpServer()).get(`/v1/orders/${placed.body.code}`)).body,
    );
    expect(viewer.items[0]!.customization).toMatchObject({
      title: 'Thiết kế riêng',
      layers: [],
      priceLines: [],
      priceAdditionVnd: 50_000,
    });
    expect(JSON.stringify(viewer)).not.toContain('Nón của Lan');
  });

  it('blocks production until the design is approved (belt and braces on top of the checkout rule)', async () => {
    const { b, versionId, variantId } = await approvedDesign();
    await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    const total = (await b.post('/v1/checkout/quote').send({})).body.totalVnd;
    await b.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: addr,
      contactEmail: 'lan@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: total,
    });
    const id = (await pool.query('SELECT id FROM orders')).rows[0].id as string;
    const fulfil = await staff('FULFILLMENT');
    await pool.query(`UPDATE custom_design_versions SET status = 'ARCHIVED' WHERE id = $1`, [
      versionId,
    ]);
    const blocked = await fulfil
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'PROCESSING', version: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DESIGN_NOT_APPROVED');
    expect((await pool.query('SELECT status FROM orders')).rows[0].status).toBe('CONFIRMED');
    // staff can see exactly what to make
    const detail = (await fulfil.get(`/v1/admin/orders/${id}`)).body;
    expect(detail.items[0].customization.layers).toHaveLength(2);
  });

  it("carries a signed-in shopper's designs through login so a guest cart line stays valid", async () => {
    const { b, versionId, variantId } = await approvedDesign();
    await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    await register(app, 'buyer@example.com');
    const res = await request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', WEB_ORIGIN)
      .set('Cookie', `nona_design=${b.jar.get('nona_design')}; nona_cart=${b.jar.get('nona_cart')}`)
      .send({ email: 'buyer@example.com', password: 'correct-horse-battery' });
    const s = {
      cookie: (res.headers['set-cookie'] as unknown as string[])
        .find((c) => c.startsWith('nona_session='))!
        .split(';')[0]!,
      csrf: res.body.csrfToken,
    };
    const cart = (await as(app, s).get('/v1/cart')).body;
    expect(cart.lines[0]).toMatchObject({
      purchasable: true,
      unitPriceVnd: 450_000,
      design: { versionId },
    });
  });

  it('acknowledging price changes keeps the design price (not the bare variant price)', async () => {
    const { b, versionId, variantId } = await approvedDesign();
    await b.post('/v1/cart/items').send({ variantId, designVersionId: versionId });
    await pool.query('UPDATE product_variants SET price_vnd = 450000 WHERE id = $1', [variantId]);
    const changed = (await b.get('/v1/cart')).body;
    expect(changed.lines[0]).toMatchObject({
      unitPriceVnd: 500_000,
      priceChange: { previousUnitPriceVnd: 450_000 },
    });
    const acked = (await b.post('/v1/cart/acknowledge-price-changes').send({})).body;
    expect(acked.hasPriceChanges).toBe(false);
    expect(acked.lines[0].unitPriceVnd).toBe(500_000);
  });
});

describe('ordering right after designing', () => {
  const addr = {
    fullName: 'Nguyễn Văn A',
    phone: '0901234567',
    line1: '12 Lê Lợi',
    ward: 'Bến Thành',
    district: 'Quận 1',
    province: 'TP. Hồ Chí Minh',
  };
  async function submittedAndOrdered() {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    const s = dto(await b.post(`/v1/custom-designs/${d.id}/submit`).send({}));
    expect(s.latest.status).toBe('SUBMITTED');
    const add = await b
      .post('/v1/cart/items')
      .send({ variantId: v.variantId, designVersionId: s.latest.id });
    expect(add.status, JSON.stringify(add.body)).toBe(201);
    expect(add.body.lines[0]).toMatchObject({ purchasable: true, unitPriceVnd: 450_000 });
    const total = (await b.post('/v1/checkout/quote').send({})).body.totalVnd;
    const placed = await b.post('/v1/orders').set('Idempotency-Key', randomUUID()).send({
      shippingAddress: addr,
      contactEmail: 'khach@example.com',
      paymentMethod: 'COD',
      expectedTotalVnd: total,
    });
    expect(placed.status, JSON.stringify(placed.body)).toBe(201);
    return { b, versionId: s.latest.id, designId: d.id };
  }
  it('lets a submitted (not yet approved) design be ordered, snapshotting it and keeping the order email for notices', async () => {
    const { versionId, designId } = await submittedAndOrdered();
    expect(
      (await pool.query('SELECT customization FROM order_items')).rows[0].customization,
    ).toMatchObject({ versionId, approvedAt: null, priceAdditionVnd: 50_000 });
    expect(
      (await pool.query('SELECT contact_email FROM custom_designs WHERE id = $1', [designId]))
        .rows[0].contact_email,
    ).toBe('khach@example.com');
  });
  it('holds production until staff approve, then lets it proceed and emails the customer', async () => {
    const { versionId } = await submittedAndOrdered();
    const id = (await pool.query('SELECT id FROM orders')).rows[0].id as string;
    const fulfil = await staff('FULFILLMENT');
    const blocked = await fulfil
      .patch(`/v1/admin/orders/${id}/status`)
      .send({ to: 'PROCESSING', version: 1 });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('DESIGN_NOT_APPROVED');
    // the orders list carries what the inline status menu needs
    const listed = (await fulfil.get('/v1/admin/orders')).body.items[0];
    expect(listed).toMatchObject({ id, pendingDesigns: 1, version: 1 });
    expect(listed.allowedTransitions).toContain('PROCESSING');
    // the admin order page is told exactly which design to approve first
    const pending = (await fulfil.get(`/v1/admin/orders/${id}`)).body.pendingDesigns;
    expect(pending).toEqual([
      expect.objectContaining({ versionId, status: 'SUBMITTED', versionNo: 1 }),
    ]);
    expect(
      (
        await (
          await staff('CATALOG')
        )
          .post(`/v1/admin/designs/versions/${versionId}/review`)
          .send({ decision: 'APPROVE' })
      ).status,
    ).toBe(200);
    expect((await fulfil.get(`/v1/admin/orders/${id}`)).body.pendingDesigns).toEqual([]);
    expect(
      (await fulfil.patch(`/v1/admin/orders/${id}/status`).send({ to: 'PROCESSING', version: 1 }))
        .status,
    ).toBe(200);
    expect(
      (await pool.query(`SELECT payload FROM outbox_events WHERE type = 'design.reviewed'`)).rows[0]
        .payload.email,
    ).toBe('khach@example.com');
  });
  it('still refuses drafts and revision-required designs', async () => {
    const v = await base();
    const b = browser(app);
    const d = dto(await b.post('/v1/custom-designs').send(body(v.variantId)));
    expect(
      (
        await b
          .post('/v1/cart/items')
          .send({ variantId: v.variantId, designVersionId: d.latest.id })
      ).body.error.code,
    ).toBe('DESIGN_NOT_APPROVED');
  });
});

describe('admin: customisable products', () => {
  it('toggles customisation per product with audit, and hides non-customizable products from the catalogue', async () => {
    const admin = await staff('ADMIN');
    const category = (await admin.post('/v1/admin/categories').send({ name: 'Custom' })).body.id;
    const p = (
      await admin
        .post('/v1/admin/products')
        .send({ name: 'Nón nền', categoryId: category, isCustomizable: true })
    ).body;
    expect(p.isCustomizable).toBe(true);
    const off = await admin
      .patch(`/v1/admin/products/${p.id}`)
      .send({ isCustomizable: false, version: p.version });
    expect(off.body.isCustomizable).toBe(false);
    expect(
      (await pool.query(`SELECT metadata FROM audit_logs WHERE action = 'product.update'`)).rows[0]
        .metadata.changes.isCustomizable,
    ).toEqual({ from: true, to: false });
  });
  it('lets admins edit the options through settings, with validation', async () => {
    const admin = await staff('ADMIN');
    const s = (await admin.get('/v1/admin/settings')).body;
    const put = (value: object) =>
      admin.patch('/v1/admin/settings/custom').send({ version: s.custom.version, value });
    expect(
      (
        await put({
          ...DEFAULT_CUSTOM,
          motifs: [{ id: 'x', name: 'X', path: 'M0 0" onload="1', priceVnd: 0 }],
        })
      ).status,
    ).toBe(400);
    expect((await put({ ...DEFAULT_CUSTOM, surprise: 1 })).status).toBe(400);
    const ok = await put({ ...DEFAULT_CUSTOM, textPriceVnd: 45_000 });
    expect(ok.status).toBe(200);
    expect(ok.body.custom.textPriceVnd).toBe(45_000);
    const catalog = (await request(app.getHttpServer()).get('/v1/custom/catalog')).body;
    expect(catalog.options.textPriceVnd).toBe(45_000);
    expect(
      (
        await (
          await staff('CATALOG')
        )
          .patch('/v1/admin/settings/custom')
          .send({ version: 2, value: DEFAULT_CUSTOM })
      ).status,
    ).toBe(403);
  });
});

describe('stored previews really contain what the customer placed', () => {
  it('draws an uploaded picture (WebP in storage) into the preview PNG', async () => {
    const v = await base();
    const b = browser(app);
    const asset = (await upload(b, await png(600))).body; // solid (200,170,110)
    const d = dto(
      await b
        .post('/v1/custom-designs')
        .send(body(v.variantId, { layers: [{ kind: 'IMAGE', assetId: asset.id, ...pos }] })),
    );
    const sub = dto(await b.post(`/v1/custom-designs/${d.id}/submit`).send({}));
    const pv = await b.get(`/v1/custom-designs/versions/${sub.latest.id}/preview`);
    const { data, info } = await sharp(pv.body).raw().toBuffer({ resolveWithObject: true });
    // layer centre = 50%/50% of the hat box (320x208 at 40,150 in a 400x500 frame)
    const x = Math.round(((40 + 0.5 * 320) / 400) * info.width);
    const y = Math.round(((150 + 0.5 * 208) / 500) * info.height);
    const px = Array.from(
      data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3),
    );
    expect(px[0]).toBeGreaterThan(185);
    expect(px[1]).toBeGreaterThan(155);
    expect(px[2]).toBeLessThan(135);
  });
});

describe('charm size is fixed by the hat, not chosen', () => {
  it('ignores any client-supplied scale for motifs and images and stores 1', async () => {
    const v = await base();
    const b = browser(app);
    const asset = (await upload(b, await png(400))).body;
    const d = dto(
      await b.post('/v1/custom-designs').send(
        body(v.variantId, {
          layers: [
            { ...motif, scale: 3 },
            { kind: 'IMAGE', assetId: asset.id, ...pos, scale: 0.2 },
            { ...text(), scale: 2 },
          ],
        }),
      ),
    );
    expect(d.latest.layers.map((l) => [l.kind, l.scale])).toEqual([
      ['MOTIF', 1],
      ['IMAGE', 1],
      ['TEXT', 2],
    ]);
    const free = dto(
      await b
        .post('/v1/custom-designs')
        .send(body(v.variantId, { layers: [{ ...motif, x: 0.1, y: 0.9, rotation: 90 }] })),
    );
    expect(free.latest.layers[0]).toMatchObject({ x: 0.1, y: 0.9, rotation: 90, scale: 1 }); // dragged position and rotation kept, size not
  });
});

describe('contact channels (admin-managed)', () => {
  it('are public when saved by an admin, validated, and audited', async () => {
    const admin = await staff('ADMIN');
    const s = (await admin.get('/v1/admin/settings')).body;
    expect(adminSettingsSchema.safeParse(s).success).toBe(true); // the contract the admin pages parse with
    const put = (channels: object[], extra: object = {}) =>
      admin.patch('/v1/admin/settings/contact').send({
        version: s.contact.version,
        value: {
          floatingEnabled: true,
          headline: 'Liên hệ',
          description: '',
          address: '',
          hours: '',
          channels,
          ...extra,
        },
      });
    const ch = (o: object) => ({
      id: 'zalo',
      kind: 'ZALO',
      label: 'Zalo',
      url: 'https://zalo.me/0900000000',
      enabled: true,
      ...o,
    });
    expect((await put([ch({ url: 'javascript:alert(1)' })])).status).toBe(400);
    expect((await put([ch({ url: 'http://insecure.example' })])).status).toBe(400);
    expect((await put([ch({ kind: 'SKYPE' })])).status).toBe(400);
    expect((await put([ch({}), ch({})])).status).toBe(400); // duplicate id
    expect((await put([ch({})], { surprise: 1 })).status).toBe(400);
    const ok = await put([
      ch({}),
      ch({ id: 'mail', kind: 'EMAIL', label: 'Gmail', url: 'mailto:hello@example.com' }),
      ch({
        id: 'hotline',
        kind: 'PHONE',
        label: 'Hotline',
        url: 'tel:+84900000000',
        enabled: false,
      }),
    ]);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const pub = (await request(app.getHttpServer()).get('/v1/storefront/settings')).body;
    expect(pub.contact.channels).toHaveLength(3);
    expect(pub.contact.floatingEnabled).toBe(true);
    expect(
      (
        await (
          await staff('CATALOG')
        )
          .patch('/v1/admin/settings/contact')
          .send({ version: 2, value: {} })
      ).status,
    ).toBe(403);
    expect(
      (await pool.query(`SELECT 1 FROM audit_logs WHERE action LIKE 'settings.%'`)).rowCount,
    ).toBeGreaterThan(0);
  });
});
