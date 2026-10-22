import { createServer } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { hash } from '@node-rs/argon2';
import type { UserRole } from '@nona/contracts';
import pg from 'pg';
import request from 'supertest';
import sharp from 'sharp';
import { createApp } from '../src/app.factory';
import { LoginThrottle } from '../src/modules/auth/infrastructure/login-throttle';

export const WEB_ORIGIN = 'http://localhost:3100';
export const PASSWORD = 'correct-horse-battery';
let counter = 0;

/** Known catalogue for custom-design tests (same shape as the seeded sample data). */
export const DEFAULT_CUSTOM = {
  enabled: true,
  requireApproval: true,
  maxLayers: 6,
  maxTextLength: 30,
  textPriceVnd: 30000,
  imagePriceVnd: 60000,
  motifs: [
    {
      id: 'star',
      name: 'Ngôi sao',
      path: 'M50 8 L61 38 L93 38 L67 57 L77 88 L50 69 L23 88 L33 57 L7 38 L39 38 Z',
      priceVnd: 20000,
    },
  ],
};

export const INTERNAL_TOKEN = 'test-internal-token-0123456789abcdef';

export interface BootOptions {
  /** Listen on a real port so the simulator's HTTP merchant API can be called by the app itself. */
  listen?: boolean;
  requireStaffMfa?: boolean;
}

export async function bootApp(
  options: BootOptions = {},
): Promise<{ app: NestExpressApplication; pool: pg.Pool; apiUrl: string }> {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL!;
  process.env.STORAGE_DRIVER = 'memory';
  process.env.MEDIA_BASE_URL = 'https://cdn.test/media';
  process.env.WEB_ORIGIN = WEB_ORIGIN;
  process.env.PAYMENTS_MODE = 'simulator';
  process.env.INTERNAL_API_TOKEN = INTERNAL_TOKEN;
  process.env.REQUIRE_STAFF_MFA = options.requireStaffMfa ? 'true' : 'false';
  let apiUrl = 'http://localhost:4100';
  let port = 0;
  if (options.listen) {
    port = await freePort();
    apiUrl = `http://127.0.0.1:${port}`;
  }
  process.env.API_PUBLIC_URL = apiUrl;
  const app = await createApp();
  if (options.listen) await app.listen(port, '127.0.0.1');
  else await app.init();
  return { app, pool: new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL }), apiUrl };
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

export async function resetAll(pool: pg.Pool, app?: NestExpressApplication) {
  app?.get(LoginThrottle).clear();
  await pool.query(
    'TRUNCATE articles, design_layers, custom_design_versions, custom_designs, design_assets, coupons, payment_events, refunds, user_mfa, orders, outbox_events, password_reset_tokens, inventory_reservations, inventory_movements, product_images, product_variants, products, categories, users, idempotency_keys CASCADE',
  );
  await pool.query(
    `INSERT INTO site_settings (key, value, version) VALUES
       ('announcement', '{"enabled": true, "text": "Miễn phí vận chuyển cho đơn từ 600.000đ", "linkUrl": null}', 1),
       ('shipping', '{"freeShippingThresholdVnd": 600000, "flatFeeVnd": 30000, "zones": []}', 1),
       ('checkout', '{"paymentWindowMinutes": 30, "requirePhoneVerification": false}', 1),
       ('custom', $1::jsonb, 1),
       ('landing', '{"hero":{"eyebrow":"","titleTop":"NONA","titleAccent":"Nón Việt","text":"","primaryCta":"Khám phá","secondaryCta":"Câu chuyện"},"story":{"eyebrow":"Câu chuyện","title":{"before":"","accent":"","after":""},"text":"","bigWord":"","badgeText":"","imageUrl":null,"imageAlt":"","stats":[]},"process":{"eyebrow":"Quy trình","title":{"before":"","accent":"","after":""},"steps":[]},"testimonials":{"eyebrow":"Khách hàng","items":[]},"order":{"eyebrow":"Đặt hàng","titleTop":"","titleAccent":"","titleBottom":"","text":""}}', 1),
       ('contact', '{"floatingEnabled": true, "headline": "Liên hệ NONA", "description": "", "address": "", "hours": "", "channels": []}', 1)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = 1`,
    [JSON.stringify(DEFAULT_CUSTOM)],
  );
}

export async function createUser(
  pool: pg.Pool,
  role: UserRole,
  overrides: { email?: string; status?: string } = {},
) {
  const email = overrides.email ?? `user${++counter}@nona.test`;
  const passwordHash = await hash(PASSWORD, {
    algorithm: 2,
    memoryCost: 8192,
    timeCost: 1,
    parallelism: 1,
  });
  const { rows } = await pool.query(
    'INSERT INTO users (email, password_hash, full_name, role, status) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [email, passwordHash, `Test ${role}`, role, overrides.status ?? 'ACTIVE'],
  );
  return { id: rows[0].id as string, email };
}

export interface Session {
  cookie: string;
  csrf: string;
}

export async function login(
  app: NestExpressApplication,
  email: string,
  password = PASSWORD,
): Promise<Session> {
  const res = await request(app.getHttpServer())
    .post('/v1/auth/login')
    .set('Origin', WEB_ORIGIN)
    .send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('nona_session='))!
    .split(';')[0]!;
  return { cookie, csrf: res.body.csrfToken };
}

/** Authenticated request helper: attaches cookie, CSRF token and a same-site Origin. */
export function as(app: NestExpressApplication, s: Session, extraCookie?: string) {
  const base = () => app.getHttpServer();
  const wrap = (r: request.Test, write: boolean) => {
    r.set('Cookie', extraCookie ? `${s.cookie}; ${extraCookie}` : s.cookie);
    if (write) r.set('Origin', WEB_ORIGIN).set('X-CSRF-Token', s.csrf);
    return r;
  };
  return {
    get: (url: string) => wrap(request(base()).get(url), false),
    post: (url: string) => wrap(request(base()).post(url), true),
    patch: (url: string) => wrap(request(base()).patch(url), true),
    put: (url: string) => wrap(request(base()).put(url), true),
    delete: (url: string) => wrap(request(base()).delete(url), true),
  };
}

export const png = (size = 800) =>
  sharp({
    create: { width: size, height: size, channels: 3, background: { r: 200, g: 170, b: 110 } },
  })
    .png()
    .toBuffer();

export const cookieFrom = (res: request.Response, name: string): string | undefined =>
  (res.headers['set-cookie'] as unknown as string[] | undefined)
    ?.find((c) => c.startsWith(`${name}=`))
    ?.split(';')[0];

/** Anonymous browser: keeps the cart cookie between calls like a real client. */
export function guest(app: NestExpressApplication) {
  let cookie: string | undefined;
  const send = (r: request.Test, write: boolean) => {
    if (cookie) r.set('Cookie', cookie);
    if (write) r.set('Origin', WEB_ORIGIN);
    return r.on('response', (res) => {
      const c = cookieFrom(res, 'nona_cart');
      if (c) cookie = c;
    });
  };
  return {
    get cookie() {
      return cookie;
    },
    get: (u: string) => send(request(app.getHttpServer()).get(u), false),
    post: (u: string) => send(request(app.getHttpServer()).post(u), true),
    patch: (u: string) => send(request(app.getHttpServer()).patch(u), true),
    delete: (u: string) => send(request(app.getHttpServer()).delete(u), true),
  };
}

export async function register(
  app: NestExpressApplication,
  email: string,
  password = PASSWORD,
  fullName = 'Khách Hàng',
) {
  const res = await request(app.getHttpServer())
    .post('/v1/auth/register')
    .set('Origin', WEB_ORIGIN)
    .send({ email, password, fullName });
  return {
    res,
    session:
      res.status === 201
        ? ({ cookie: cookieFrom(res, 'nona_session')!, csrf: res.body.csrfToken } as Session)
        : undefined,
  };
}

/** A full anonymous browser: keeps every cookie (cart, design, session) like a real client. */
export function browser(app: NestExpressApplication) {
  const jar = new Map<string, string>();
  const header = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  const send = (r: request.Test, write: boolean) => {
    const c = header();
    if (c) r.set('Cookie', c);
    if (write) r.set('Origin', WEB_ORIGIN);
    return r.on('response', (res) => {
      for (const line of (res.headers['set-cookie'] as unknown as string[] | undefined) ?? []) {
        const [pair] = line.split(';');
        const [name, ...rest] = pair!.split('=');
        const value = rest.join('=');
        if (value === '') jar.delete(name!);
        else jar.set(name!, value);
      }
    });
  };
  const csrf = { token: '' };
  return {
    jar,
    useSession(s: Session) {
      jar.set('nona_session', s.cookie.split('=')[1]!);
      csrf.token = s.csrf;
    },
    get: (u: string) => send(request(app.getHttpServer()).get(u), false),
    post: (u: string) => {
      const r = send(request(app.getHttpServer()).post(u), true);
      if (csrf.token) r.set('X-CSRF-Token', csrf.token);
      return r;
    },
    patch: (u: string) => {
      const r = send(request(app.getHttpServer()).patch(u), true);
      if (csrf.token) r.set('X-CSRF-Token', csrf.token);
      return r;
    },
    delete: (u: string) => {
      const r = send(request(app.getHttpServer()).delete(u), true);
      if (csrf.token) r.set('X-CSRF-Token', csrf.token);
      return r;
    },
  };
}
