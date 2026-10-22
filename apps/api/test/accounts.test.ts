import type { NestExpressApplication } from '@nestjs/platform-express';
import { addressListSchema, meSchema } from '@nona/contracts';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createCategory, createProduct } from './factories';
import { as, bootApp, login, PASSWORD, register, resetAll, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(() => resetAll(pool, app));

describe('registration', () => {
  it('creates a CUSTOMER, signs them in, and keeps them out of the admin area', async () => {
    const { res, session } = await register(app, 'Khach.Moi@Example.com', PASSWORD, 'Nguyễn Văn A');
    expect(res.status).toBe(201);
    const me = meSchema.parse(res.body);
    expect(me).toMatchObject({
      email: 'khach.moi@example.com',
      role: 'CUSTOMER',
      fullName: 'Nguyễn Văn A',
      permissions: [],
    });
    expect(res.headers['set-cookie']![0]).toMatch(/HttpOnly/);
    expect(JSON.stringify(res.body)).not.toMatch(/argon2|password_hash/i);
    expect((await as(app, session!).get('/v1/admin/products')).status).toBe(403);
    expect(
      (await pool.query(`SELECT role FROM users WHERE email = 'khach.moi@example.com'`)).rows[0]
        .role,
    ).toBe('CUSTOMER');
  });

  it('cannot be used to self-assign a role', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('Origin', WEB_ORIGIN)
      .send({ email: 'sneaky@example.com', password: PASSWORD, fullName: 'X', role: 'ADMIN' });
    expect(res.status).toBe(201);
    expect(res.body.role).toBe('CUSTOMER');
  });

  it('validates input and rejects duplicate emails (case-insensitively)', async () => {
    const post = (b: object) =>
      request(app.getHttpServer()).post('/v1/auth/register').set('Origin', WEB_ORIGIN).send(b);
    expect((await post({ email: 'bad', password: PASSWORD, fullName: 'A' })).status).toBe(400);
    expect((await post({ email: 'a@example.com', password: 'short', fullName: 'A' })).status).toBe(
      400,
    );
    expect(
      (await post({ email: 'a@example.com', password: 'a@example.com', fullName: 'A' })).status,
    ).toBe(400);
    expect((await post({ email: 'a@example.com', password: PASSWORD, fullName: '' })).status).toBe(
      400,
    );
    expect(
      (await post({ email: 'dup@example.com', password: PASSWORD, fullName: 'A' })).status,
    ).toBe(201);
    const dup = await post({ email: 'DUP@example.com', password: PASSWORD, fullName: 'B' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('CONFLICT');
  });

  it('rate-limits repeated sign-ups from one address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) {
      statuses.push(
        (
          await request(app.getHttpServer())
            .post('/v1/auth/register')
            .set('Origin', WEB_ORIGIN)
            .send({ email: `bulk${i}@example.com`, password: PASSWORD, fullName: 'B' })
        ).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 201)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('customer sessions', () => {
  it('stay valid across long idle periods for customers but not forever', async () => {
    const { session } = await register(app, 'long@example.com');
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '20 days'`);
    expect((await as(app, session!).get('/v1/me')).status).toBe(200);
    await pool.query(`UPDATE sessions SET last_seen_at = now() - interval '31 days'`);
    expect((await as(app, session!).get('/v1/me')).status).toBe(401);
  });

  it('refresh rotates the token and CSRF token; the old cookie dies', async () => {
    const { session } = await register(app, 'rot@example.com');
    const res = await as(app, session!).post('/v1/auth/refresh');
    expect(res.status).toBe(200);
    const next = {
      cookie: (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!,
      csrf: res.body.csrfToken,
    };
    expect(next.cookie).not.toBe(session!.cookie);
    expect(next.csrf).not.toBe(session!.csrf);
    expect((await as(app, session!).get('/v1/me')).status).toBe(401);
    expect((await as(app, next).get('/v1/me')).status).toBe(200);
  });
});

describe('session probe', () => {
  it('answers 200 for guests and signed-in users alike', async () => {
    const guestRes = await request(app.getHttpServer()).get('/v1/auth/session');
    expect(guestRes.status).toBe(200);
    expect(guestRes.body).toEqual({ user: null });
    const { session } = await register(app, 'probe@example.com');
    const me = await as(app, session!).get('/v1/auth/session');
    expect(me.body.user.email).toBe('probe@example.com');
    const stale = await request(app.getHttpServer())
      .get('/v1/auth/session')
      .set('Cookie', 'nona_session=invalid');
    expect(stale.body).toEqual({ user: null });
  });
});

describe('profile and password', () => {
  it('updates the display name', async () => {
    const { session } = await register(app, 'p@example.com');
    const res = await as(app, session!).patch('/v1/me').send({ fullName: 'Tên Mới' });
    expect(res.body.fullName).toBe('Tên Mới');
    expect((await as(app, session!).patch('/v1/me').send({ fullName: '' })).status).toBe(400);
  });

  it('requires the current password, then signs out every other session', async () => {
    const { session: a } = await register(app, 'pw@example.com');
    const b = await login(app, 'pw@example.com');
    const change = (
      s: typeof a,
      body: { currentPassword: string; newPassword: string; confirmPassword?: string },
    ) =>
      as(app, s!)
        .post('/v1/me/password')
        .send({ confirmPassword: body.newPassword, ...body });
    expect(
      (
        await change(a, {
          currentPassword: 'wrong-password-1',
          newPassword: 'another-long-password',
        })
      ).status,
    ).toBe(401);
    expect((await change(a, { currentPassword: PASSWORD, newPassword: 'short' })).status).toBe(400);
    // the second typing has to match
    expect(
      (
        await change(a, {
          currentPassword: PASSWORD,
          newPassword: 'another-long-password',
          confirmPassword: 'another-long-passwore',
        })
      ).status,
    ).toBe(400);
    expect(
      (await change(a, { currentPassword: PASSWORD, newPassword: 'another-long-password' })).status,
    ).toBe(204);
    expect((await as(app, a!).get('/v1/me')).status).toBe(200); // current session survives
    expect((await as(app, b).get('/v1/me')).status).toBe(401); // other device is signed out
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .set('Origin', WEB_ORIGIN)
          .send({ email: 'pw@example.com', password: PASSWORD })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .set('Origin', WEB_ORIGIN)
          .send({ email: 'pw@example.com', password: 'another-long-password' })
      ).status,
    ).toBe(200);
  });
});

describe('addresses', () => {
  const address = (over: object = {}) => ({
    fullName: 'Nguyễn Văn A',
    phone: '0901 234 567',
    line1: '12 Lê Lợi',
    ward: 'Bến Thành',
    district: 'Quận 1',
    province: 'TP. Hồ Chí Minh',
    ...over,
  });

  it('requires a session and a CSRF token', async () => {
    expect((await request(app.getHttpServer()).get('/v1/me/addresses')).status).toBe(401);
    const { session } = await register(app, 'csrf@example.com');
    const noCsrf = await request(app.getHttpServer())
      .post('/v1/me/addresses')
      .set('Cookie', session!.cookie)
      .set('Origin', WEB_ORIGIN)
      .send(address());
    expect(noCsrf.status).toBe(403);
  });

  it('makes the first address default, normalizes the phone, and moves the default on request', async () => {
    const { session } = await register(app, 'addr@example.com');
    const api = as(app, session!);
    const first = addressListSchema.parse(
      (await api.post('/v1/me/addresses').send(address())).body,
    );
    expect(first.items[0]).toMatchObject({ isDefault: true, phone: '0901234567' });
    const second = addressListSchema.parse(
      (
        await api
          .post('/v1/me/addresses')
          .send(address({ line1: '99 Hai Bà Trưng', isDefault: true }))
      ).body,
    );
    expect(second.items.filter((a) => a.isDefault)).toHaveLength(1);
    expect(second.items[0]!.line1).toBe('99 Hai Bà Trưng');
    const firstId = second.items.find((a) => a.line1 === '12 Lê Lợi')!.id;
    const unset = await api
      .patch(`/v1/me/addresses/${second.items[0]!.id}`)
      .send({ isDefault: false });
    expect(unset.status).toBe(409);
    const moved = await api
      .patch(`/v1/me/addresses/${firstId}`)
      .send({ isDefault: true, ward: 'Đa Kao' });
    expect(moved.body.items.find((a: { id: string }) => a.id === firstId)).toMatchObject({
      isDefault: true,
      ward: 'Đa Kao',
    });
  });

  it('promotes another address when the default is deleted', async () => {
    const { session } = await register(app, 'del@example.com');
    const api = as(app, session!);
    await api.post('/v1/me/addresses').send(address());
    const two = (await api.post('/v1/me/addresses').send(address({ line1: 'B' }))).body.items;
    const def = two.find((a: { isDefault: boolean }) => a.isDefault);
    const after = (await api.delete(`/v1/me/addresses/${def.id}`)).body.items;
    expect(after).toHaveLength(1);
    expect(after[0].isDefault).toBe(true);
  });

  it('validates fields and caps the number of addresses', async () => {
    const { session } = await register(app, 'cap@example.com');
    const api = as(app, session!);
    expect((await api.post('/v1/me/addresses').send(address({ phone: '12345' }))).status).toBe(400);
    expect((await api.post('/v1/me/addresses').send(address({ province: '' }))).status).toBe(400);
    for (let i = 0; i < 10; i++)
      expect((await api.post('/v1/me/addresses').send(address({ line1: `Số ${i}` }))).status).toBe(
        201,
      );
    expect((await api.post('/v1/me/addresses').send(address({ line1: 'Số 11' }))).status).toBe(409);
  });

  it("never exposes or modifies another customer's address", async () => {
    const { session: a } = await register(app, 'a@example.com');
    const { session: b } = await register(app, 'b@example.com');
    const mine = (await as(app, a!).post('/v1/me/addresses').send(address())).body.items[0];
    expect((await as(app, b!).get('/v1/me/addresses')).body.items).toEqual([]);
    expect(
      (await as(app, b!).patch(`/v1/me/addresses/${mine.id}`).send({ line1: 'hacked' })).status,
    ).toBe(404);
    expect((await as(app, b!).delete(`/v1/me/addresses/${mine.id}`)).status).toBe(404);
    expect(
      (await pool.query('SELECT line1 FROM addresses WHERE id = $1', [mine.id])).rows[0].line1,
    ).toBe('12 Lê Lợi');
  });
});

describe('wishlist', () => {
  it('adds idempotently, removes, hides unpublished products, and 404s unknown slugs', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, slug: 'sen' });
    await createProduct(pool, { categoryId: cat, slug: 'nhap', status: 'DRAFT' });
    const { session } = await register(app, 'w@example.com');
    const api = as(app, session!);
    expect((await api.post('/v1/wishlist/items').send({ productSlug: 'sen' })).body.slugs).toEqual([
      'sen',
    ]);
    expect((await api.post('/v1/wishlist/items').send({ productSlug: 'sen' })).body.slugs).toEqual([
      'sen',
    ]);
    expect((await api.post('/v1/wishlist/items').send({ productSlug: 'nhap' })).status).toBe(404);
    expect((await api.post('/v1/wishlist/items').send({ productSlug: 'nope' })).status).toBe(404);
    expect((await api.delete('/v1/wishlist/items/sen')).body.slugs).toEqual([]);
  });

  it('merges browser favourites, ignoring unknown, unpublished and malformed slugs', async () => {
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, slug: 'a' });
    await createProduct(pool, { categoryId: cat, slug: 'b' });
    await createProduct(pool, { categoryId: cat, slug: 'c', status: 'DRAFT' });
    const { session } = await register(app, 'm@example.com');
    const res = await as(app, session!)
      .post('/v1/wishlist/merge')
      .send({ slugs: ['a', 'b', 'c', 'zzz', 'Bad Slug!'] });
    expect(res.body.slugs.sort()).toEqual(['a', 'b']);
  });

  it('is private to the signed-in user', async () => {
    expect((await request(app.getHttpServer()).get('/v1/wishlist')).status).toBe(401);
    const cat = await createCategory(pool);
    await createProduct(pool, { categoryId: cat, slug: 'x' });
    const { session: a } = await register(app, 'one@example.com');
    const { session: b } = await register(app, 'two@example.com');
    await as(app, a!).post('/v1/wishlist/items').send({ productSlug: 'x' });
    expect((await as(app, b!).get('/v1/wishlist')).body.slugs).toEqual([]);
  });
});

describe('password reset', () => {
  const forgot = (email: string) =>
    request(app.getHttpServer())
      .post('/v1/auth/forgot-password')
      .set('Origin', WEB_ORIGIN)
      .send({ email });
  const reset = (token: string, newPassword = 'a-brand-new-password') =>
    request(app.getHttpServer())
      .post('/v1/auth/reset-password')
      .set('Origin', WEB_ORIGIN)
      .send({ token, newPassword, confirmPassword: newPassword });
  const tokenFromOutbox = async () => {
    const row = (
      await pool.query(
        `SELECT payload FROM outbox_events WHERE type = 'auth.password_reset' ORDER BY created_at DESC LIMIT 1`,
      )
    ).rows[0];
    return new URL(row.payload.resetPath, 'http://x').searchParams.get('token')!;
  };

  it('answers identically for known and unknown emails and only queues mail for real accounts', async () => {
    await register(app, 'real@example.com');
    const known = await forgot('real@example.com');
    const unknown = await forgot('ghost@example.com');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);
    expect(
      (
        await pool.query(
          `SELECT payload->>'email' e FROM outbox_events WHERE type = 'auth.password_reset'`,
        )
      ).rows,
    ).toEqual([{ e: 'real@example.com' }]);
    const stored = (await pool.query('SELECT token_hash FROM password_reset_tokens')).rows[0]
      .token_hash;
    expect(stored).not.toBe(await tokenFromOutbox()); // only a hash is stored
  });

  it('resets once, signs out every session, and the old password stops working', async () => {
    const { session } = await register(app, 'reset@example.com');
    await forgot('reset@example.com');
    const token = await tokenFromOutbox();
    expect((await reset(token)).status).toBe(204);
    expect((await as(app, session!).get('/v1/me')).status).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .set('Origin', WEB_ORIGIN)
          .send({ email: 'reset@example.com', password: PASSWORD })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app.getHttpServer())
          .post('/v1/auth/login')
          .set('Origin', WEB_ORIGIN)
          .send({ email: 'reset@example.com', password: 'a-brand-new-password' })
      ).status,
    ).toBe(200);
    const again = await reset(token, 'yet-another-password-1');
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects expired, unknown and superseded tokens and weak passwords', async () => {
    await register(app, 'tok@example.com');
    await forgot('tok@example.com');
    const first = await tokenFromOutbox();
    await forgot('tok@example.com');
    const second = await tokenFromOutbox();
    expect((await reset(first)).status).toBe(400); // superseded by the newer request
    expect((await reset('x'.repeat(43))).status).toBe(400);
    expect((await reset(second, 'short')).status).toBe(400);
    await pool.query(
      `UPDATE password_reset_tokens SET expires_at = now() - interval '1 second' WHERE used_at IS NULL`,
    );
    expect((await reset(second)).body.error.code).toBe('TOKEN_INVALID');
  });

  it('throttles repeated requests for the same address', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await forgot('spam@example.com')).status);
    expect(statuses).toEqual([202, 202, 202, 429, 429]);
  });
});
