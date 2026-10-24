import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bootApp, cookieFrom, createUser, resetAll, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  process.env.GOOGLE_CLIENT_SECRET = 'secret-xyz';
  ({ app, pool } = await bootApp());
});
afterAll(async () => {
  await app.close();
  await pool.end();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
});
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE user_identities, outbox_events');
  vi.restoreAllMocks();
});

const CLIENT = 'client-123.apps.googleusercontent.com';
const idToken = (c: Record<string, unknown>) =>
  `x.${Buffer.from(JSON.stringify(c)).toString('base64url')}.y`;
const claims = (over: Record<string, unknown> = {}, nonce?: string) => ({
  iss: 'https://accounts.google.com',
  aud: CLIENT,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub: 'google-sub-1',
  email: 'new.user@gmail.com',
  email_verified: true,
  name: 'Nguyễn Văn A',
  nonce,
  ...over,
});

/** Starts the flow, then answers the token request like Google would (for the nonce in the cookie). */
async function signIn(
  over: Record<string, unknown> = {},
  opts: { state?: string; cookie?: boolean } = {},
) {
  const start = await request(app.getHttpServer()).get('/v1/auth/google/start?next=/gio-hang');
  expect(start.status).toBe(302);
  const url = new URL(start.headers.location!);
  const cookie = cookieFrom(start, 'nona_oauth')!;
  const real = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).startsWith('https://oauth2.googleapis.com/token'))
      return new Response(
        JSON.stringify({
          id_token: idToken(claims(over, url.searchParams.get('nonce') ?? undefined)),
        }),
        { status: 200 },
      );
    return real(input, init);
  });
  const cb = await request(app.getHttpServer())
    .get(`/v1/auth/google/callback?code=abc&state=${opts.state ?? url.searchParams.get('state')}`)
    .set('Cookie', opts.cookie === false ? '' : cookie);
  return { start, url, cb };
}

describe('sign in with Google', () => {
  it('reports whether Google sign-in is available', async () => {
    expect((await request(app.getHttpServer()).get('/v1/auth/providers')).body).toEqual({
      google: true,
      phone: { provider: 'sms', firebase: null },
    });
  });

  it('sends the browser to Google with state, nonce and PKCE, and remembers them in a signed cookie', async () => {
    const start = await request(app.getHttpServer()).get('/v1/auth/google/start?next=/gio-hang');
    const url = new URL(start.headers.location!);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe(CLIENT);
    expect(url.searchParams.get('redirect_uri')).toBe(`${WEB_ORIGIN}/api/auth/google/callback`);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBeTruthy();
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(String(start.headers['set-cookie'])).toMatch(/nona_oauth=.*HttpOnly/);
  });

  it('creates a confirmed customer on first sign-in, logs them in and returns them to where they were', async () => {
    const { cb } = await signIn();
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe(`${WEB_ORIGIN}/gio-hang`);
    expect(cookieFrom(cb, 'nona_session')).toBeTruthy();
    const u = (
      await pool.query(
        "SELECT id, role, full_name, email_verified_at FROM users WHERE email='new.user@gmail.com'",
      )
    ).rows[0];
    expect(u).toMatchObject({ role: 'CUSTOMER', full_name: 'Nguyễn Văn A' });
    expect(u.email_verified_at).toBeTruthy();
    expect(
      (await pool.query('SELECT subject FROM user_identities WHERE user_id=$1', [u.id])).rows[0]
        .subject,
    ).toBe('google-sub-1');
    expect(
      (await pool.query("SELECT 1 FROM outbox_events WHERE type='auth.welcome'")).rowCount,
    ).toBe(1);
  });

  it('signs the same Google account in again without creating another user', async () => {
    await signIn();
    const second = await signIn();
    expect(second.cb.headers.location).toBe(`${WEB_ORIGIN}/gio-hang`);
    expect(cookieFrom(second.cb, 'nona_session')).toBeTruthy();
    expect(
      (await pool.query("SELECT COUNT(*)::int AS n FROM users WHERE email='new.user@gmail.com'"))
        .rows[0].n,
    ).toBe(1);
  });

  it('refuses when the email already has an account, and never links or logs in', async () => {
    await createUser(pool, 'CUSTOMER', { email: 'new.user@gmail.com' });
    const { cb } = await signIn();
    expect(cb.headers.location).toContain('/dang-nhap?loi=google-trung-email');
    expect(cookieFrom(cb, 'nona_session')).toBeUndefined();
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM user_identities')).rows[0].n).toBe(0);
  });

  it('refuses a staff email as well', async () => {
    await createUser(pool, 'ADMIN', { email: 'new.user@gmail.com' });
    const { cb } = await signIn();
    expect(cb.headers.location).toContain('google-trung-email');
  });

  it('rejects a wrong state, a missing cookie, an unverified email, a wrong audience and a wrong nonce', async () => {
    expect((await signIn({}, { state: 'forged' })).cb.headers.location).toContain('loi=google-loi');
    expect((await signIn({}, { cookie: false })).cb.headers.location).toContain('loi=google-loi');
    expect((await signIn({ email_verified: false })).cb.headers.location).toContain(
      'google-chua-xac-thuc',
    );
    expect((await signIn({ aud: 'someone-else' })).cb.headers.location).toContain('loi=google-loi');
    expect((await signIn({ nonce: 'replayed' })).cb.headers.location).toContain('loi=google-loi');
    expect((await signIn({ exp: 1 })).cb.headers.location).toContain('loi=google-loi');
    expect((await pool.query('SELECT COUNT(*)::int AS n FROM users')).rows[0].n).toBe(0);
  });

  it('treats a cancelled consent as a normal outcome', async () => {
    const cb = await request(app.getHttpServer()).get(
      '/v1/auth/google/callback?error=access_denied',
    );
    expect(cb.headers.location).toContain('loi=google-huy');
  });

  it('only returns to same-site paths', async () => {
    const start = await request(app.getHttpServer()).get(
      '/v1/auth/google/start?next=//evil.example',
    );
    const cookie = cookieFrom(start, 'nona_oauth')!;
    const url = new URL(start.headers.location!);
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async () =>
        new Response(
          JSON.stringify({ id_token: idToken(claims({}, url.searchParams.get('nonce')!)) }),
          { status: 200 },
        ),
    );
    const cb = await request(app.getHttpServer())
      .get(`/v1/auth/google/callback?code=abc&state=${url.searchParams.get('state')}`)
      .set('Cookie', cookie);
    expect(cb.headers.location).toBe(`${WEB_ORIGIN}/tai-khoan`);
  });
});
