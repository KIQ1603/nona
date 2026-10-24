import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, WEB_ORIGIN } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => {
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  ({ app, pool } = await bootApp());
});
afterAll(async () => {
  await app.close();
  await pool.end();
});

describe('Google sign-in without keys', () => {
  it('reports itself as off and sends the shopper back with an explanation instead of an error page', async () => {
    expect((await request(app.getHttpServer()).get('/v1/auth/providers')).body).toEqual({
      google: false,
      phone: { provider: 'sms', firebase: null },
    });
    const start = await request(app.getHttpServer()).get('/v1/auth/google/start?next=/gio-hang');
    expect(start.status).toBe(302);
    expect(start.headers.location).toBe(
      `${WEB_ORIGIN}/dang-nhap?loi=google-chua-cau-hinh&next=%2Fgio-hang`,
    );
    const cb = await request(app.getHttpServer()).get('/v1/auth/google/callback?code=x&state=y');
    expect(cb.headers.location).toContain('loi=google-chua-cau-hinh');
  });
});
