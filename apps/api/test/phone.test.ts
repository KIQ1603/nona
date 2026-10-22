import type { NestExpressApplication } from '@nestjs/platform-express';
import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { as, bootApp, createUser, login, resetAll } from './helpers';

let app: NestExpressApplication;
let pool: pg.Pool;
beforeAll(async () => ({ app, pool } = await bootApp()));
afterAll(async () => {
  await app.close();
  await pool.end();
});
beforeEach(async () => {
  await resetAll(pool, app);
  await pool.query('TRUNCATE phone_otps, outbox_events');
});

const customer = async (email?: string) => {
  const u = await createUser(pool, 'CUSTOMER', { email });
  return { ...u, api: as(app, await login(app, u.email)) };
};
type Api = Awaited<ReturnType<typeof customer>>['api'];
const ask = (api: Api, phone: string) => api.post('/v1/me/phone/otp').send({ phone });
const send = (api: Api, code: string) => api.post('/v1/me/phone/verify').send({ code });
const wrong = (code: string) => (code === '000000' ? '111111' : '000000');

describe('phone OTP', () => {
  it('requires a signed-in user', async () => {
    expect((await request(app.getHttpServer()).get('/v1/me/phone')).status).toBe(401);
  });

  it('sends a code through the outbox and verifies the number', async () => {
    const { api } = await customer();
    expect((await api.get('/v1/me/phone')).body).toEqual({ phone: null, verified: false });
    const res = await ask(api, '0912 345 678');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ phone: '+84 *** *** 678', expiresInSeconds: 300 });
    expect(res.body.devCode).toMatch(/^\d{6}$/); // simulator mode
    const ev = (await pool.query("SELECT payload FROM outbox_events WHERE type = 'phone.otp'"))
      .rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].payload).toMatchObject({ phone: '+84912345678', code: res.body.devCode });
    // only a hash is stored
    expect((await pool.query('SELECT code_hash FROM phone_otps')).rows[0].code_hash).not.toContain(
      res.body.devCode,
    );

    const ok = await send(api, res.body.devCode);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toEqual({ phone: '+84 *** *** 678', verified: true });
    expect((await api.get('/v1/me/phone')).body.verified).toBe(true);
    expect((await send(api, res.body.devCode)).status).toBe(400); // a code works once
    expect((await ask(api, '0912345678')).status).toBe(409); // already verified
    expect(
      (await pool.query("SELECT 1 FROM audit_logs WHERE action = 'account.phone_verified'"))
        .rowCount,
    ).toBe(1);
  });

  it('rejects malformed numbers and malformed codes', async () => {
    const { api } = await customer();
    expect((await ask(api, '12345')).status).toBe(400);
    expect((await ask(api, 'abc')).status).toBe(400);
    await ask(api, '0912345678');
    expect((await send(api, '12ab56')).status).toBe(400);
    expect((await send(api, '12345')).status).toBe(400);
  });

  it('counts wrong codes and locks the code after 5 tries', async () => {
    const { api } = await customer();
    const { body } = await ask(api, '0912345678');
    const bad = wrong(body.devCode);
    for (let i = 4; i >= 1; i--) {
      const r = await send(api, bad);
      expect(r.status).toBe(400);
      expect(r.body.error.details.attemptsLeft).toBe(i);
    }
    expect((await send(api, bad)).status).toBe(400); // 5th wrong try
    expect((await send(api, body.devCode)).status).toBe(400); // even the right code no longer works
    expect((await api.get('/v1/me/phone')).body.verified).toBe(false);
  });

  it('expires a code after 5 minutes', async () => {
    const { api } = await customer();
    const { body } = await ask(api, '0912345678');
    await pool.query("UPDATE phone_otps SET expires_at = now() - interval '1 second'");
    expect((await send(api, body.devCode)).status).toBe(400);
  });

  it('makes you wait before asking again, and limits sends per hour', async () => {
    const { api } = await customer();
    expect((await ask(api, '0912345678')).status).toBe(200);
    const again = await ask(api, '0912345678');
    expect(again.status).toBe(429);
    expect(again.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    for (let i = 0; i < 4; i++) {
      await pool.query("UPDATE phone_otps SET created_at = created_at - interval '2 minutes'");
      expect((await ask(api, '0912345678')).status).toBe(200);
    }
    await pool.query("UPDATE phone_otps SET created_at = created_at - interval '2 minutes'");
    expect((await ask(api, '0912345678')).status).toBe(429); // 5 per hour used up
  });

  it('only the newest code is valid', async () => {
    const { api } = await customer();
    const first = (await ask(api, '0912345678')).body.devCode as string;
    await pool.query("UPDATE phone_otps SET created_at = created_at - interval '2 minutes'");
    const second = (await ask(api, '0912345678')).body.devCode as string;
    if (first !== second) expect((await send(api, first)).status).toBe(400);
    expect((await send(api, second)).status).toBe(200);
  });

  it('lets one account own a verified number; others are refused, and removing frees it', async () => {
    const a = await customer();
    const b = await customer();
    const code = (await ask(a.api, '0912345678')).body.devCode;
    await send(a.api, code);
    const refused = await ask(b.api, '0912345678');
    expect(refused.status).toBe(409);
    expect((await a.api.delete('/v1/me/phone')).body).toEqual({ phone: null, verified: false });
    expect((await ask(b.api, '0912345678')).status).toBe(200);
  });

  it('a code for one number cannot verify another', async () => {
    const { api } = await customer();
    const { body } = await ask(api, '0912345678');
    await pool.query("UPDATE phone_otps SET created_at = created_at - interval '2 minutes'");
    const other = await ask(api, '0987654321'); // replaces the first code
    expect(
      (await send(api, body.devCode)).status === 200 && other.body.devCode !== body.devCode,
    ).toBe(false);
    expect((await send(api, other.body.devCode)).body.phone).toBe('+84 *** *** 321');
  });
});
