import type { Mailer, MailMessage } from '@nona/mail';
import pg from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup } from '../src/jobs/cleanup.js';
import { backoffSeconds, MAX_ATTEMPTS, processOutbox } from '../src/jobs/outbox.js';
import {
  DEFAULT_ESMS_TEMPLATE,
  EsmsSender,
  SmsRejectedError,
  ZaloZnsSender,
  type SmsSender,
} from '../src/sms.js';
import { checkAlerts } from '../src/jobs/alerts.js';
import { callInternalJob } from '../src/jobs/internal.js';

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
afterAll(() => pool.end());
beforeEach(() =>
  pool.query(
    'TRUNCATE outbox_events, inventory_reservations, carts, password_reset_tokens, sessions, idempotency_keys, order_items, orders, inventory_movements, product_images, product_variants, products, categories, users CASCADE',
  ),
);

class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  failures = 0;
  async send(m: MailMessage) {
    if (this.failures > 0) {
      this.failures--;
      throw new Error('smtp down');
    }
    this.sent.push(m);
  }
}
const opts = { webOrigin: 'https://nona.vn' };
const placed = (email: string, code: string) => ({
  orderCode: code,
  email,
  customerName: 'A',
  paymentMethod: 'COD',
  items: [{ name: 'Nón', variant: 'Tiêu chuẩn', quantity: 1, lineTotalVnd: 100000 }],
  subtotalVnd: 100000,
  discountVnd: 0,
  shippingFeeVnd: 30000,
  totalVnd: 130000,
  address: {
    fullName: 'A',
    phone: '0901234567',
    line1: 'x',
    ward: 'w',
    district: 'd',
    province: 'p',
  },
});
const enqueue = (type: string, payload: object) =>
  pool.query('INSERT INTO outbox_events (type, payload) VALUES ($1,$2::jsonb)', [
    type,
    JSON.stringify(payload),
  ]);
const events = async () =>
  (await pool.query('SELECT * FROM outbox_events ORDER BY created_at, id')).rows;

describe('events without an email address', () => {
  it('skips the email of an order placed by a phone-only account instead of dead-lettering it', async () => {
    await enqueue('order.placed', { ...placed('x@example.com', 'AB12CD34EF56'), email: null });
    expect(await processOutbox(pool, new FakeMailer(), opts)).toMatchObject({
      skipped: 1,
      dead: 0,
    });
    expect((await events())[0].status).toBe('SENT');
  });
});

describe('phone OTP delivery', () => {
  const otp = (extra: object = {}) =>
    enqueue('phone.otp', {
      phone: '+84912345678',
      code: '123456',
      ttlMinutes: 5,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      ...extra,
    });
  const fake = () => {
    const sent: string[][] = [];
    const sms: SmsSender = {
      sendOtp: async (p, c, t) => void sent.push([p, c, String(t)]),
    };
    return { sent, sms };
  };

  it('sends the code through the SMS sender and scrubs it from the stored event', async () => {
    await otp();
    const { sent, sms } = fake();
    expect(await processOutbox(pool, new FakeMailer(), { ...opts, sms })).toMatchObject({
      sent: 1,
    });
    expect(sent).toEqual([['+84912345678', '123456', '5']]);
    const [e] = await events();
    expect(e.status).toBe('SENT');
    expect(e.payload).toEqual({}); // the code is not kept
  });

  it('drops a code that expired before it could be sent', async () => {
    await otp({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    const { sent, sms } = fake();
    expect(await processOutbox(pool, new FakeMailer(), { ...opts, sms })).toMatchObject({
      skipped: 1,
    });
    expect(sent).toHaveLength(0);
  });

  it('dead-letters at once when the provider refuses the number, and scrubs the code', async () => {
    await otp();
    const sms: SmsSender = {
      sendOtp: async () => {
        throw new SmsRejectedError('not on Zalo');
      },
    };
    expect(await processOutbox(pool, new FakeMailer(), { ...opts, sms })).toMatchObject({
      dead: 1,
    });
    expect((await events())[0].payload).toEqual({});
  });

  it('speaks the Zalo ZNS API: 84-prefixed number, template data, access token header', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ error: 0, message: 'Success' }), { status: 200 });
    }) as typeof fetch;
    try {
      const sender = new ZaloZnsSender({
        accessToken: async () => 'tok',
        templateId: '123',
        codeParam: 'otp',
        ttlParam: 'minutes',
        apiUrl: 'https://zalo.test/message/template',
      });
      await sender.sendOtp('+84912345678', '654321', 5);
      const body = JSON.parse(String(seen!.init.body));
      expect(body).toMatchObject({
        phone: '84912345678',
        template_id: '123',
        template_data: { otp: '654321', minutes: '5' },
      });
      expect((seen!.init.headers as Record<string, string>).access_token).toBe('tok');
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: -118, message: 'user not found' }), {
          status: 200,
        })) as typeof fetch;
      await expect(sender.sendOtp('+84912345678', '1', 5)).rejects.toBeInstanceOf(SmsRejectedError);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe('outbox', () => {
  it('sends the email, marks SENT, and scrubs personal data from the stored payload', async () => {
    await enqueue('order.placed', placed('a@example.com', 'AB12CD34EF56'));
    const mailer = new FakeMailer();
    expect(await processOutbox(pool, mailer, opts)).toMatchObject({ sent: 1, retried: 0, dead: 0 });
    expect(mailer.sent[0]).toMatchObject({ to: 'a@example.com' });
    expect(mailer.sent[0]!.subject).toContain('AB12-CD34-EF56');
    const [e] = await events();
    expect(e.status).toBe('SENT');
    expect(e.payload).toEqual({ orderCode: 'AB12CD34EF56' }); // email/address/items are gone
    expect(await processOutbox(pool, mailer, opts)).toMatchObject({ sent: 0 }); // not sent twice
    expect(mailer.sent).toHaveLength(1);
  });

  it('retries a failing delivery with exponential backoff and eventually dead-letters it', async () => {
    await enqueue('order.placed', placed('a@example.com', 'AB12CD34EF56'));
    const mailer = new FakeMailer();
    mailer.failures = 99;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await processOutbox(pool, mailer, opts)).toMatchObject({ retried: 1 });
      const [e] = await events();
      expect(e).toMatchObject({ status: 'PENDING', attempts: attempt, last_error: 'smtp down' });
      const delay = (e.next_attempt_at.getTime() - Date.now()) / 1000;
      expect(delay).toBeGreaterThan(backoffSeconds(attempt) - 5);
      expect(delay).toBeLessThanOrEqual(backoffSeconds(attempt) + 1);
      expect(await processOutbox(pool, mailer, opts)).toMatchObject({ sent: 0, retried: 0 }); // not due yet
      await pool.query(`UPDATE outbox_events SET next_attempt_at = now() - interval '1 second'`);
    }
    expect(await processOutbox(pool, mailer, opts)).toMatchObject({ dead: 1 });
    expect((await events())[0]).toMatchObject({ status: 'DEAD', attempts: MAX_ATTEMPTS });
    expect(mailer.sent).toHaveLength(0);
  });

  it('recovers when the mail server comes back, without losing the event', async () => {
    await enqueue('auth.password_reset', {
      email: 'r@example.com',
      fullName: 'R',
      resetPath: '/dat-lai-mat-khau?token=abc',
    });
    const mailer = new FakeMailer();
    mailer.failures = 2;
    await processOutbox(pool, mailer, opts);
    await pool.query(`UPDATE outbox_events SET next_attempt_at = now()`);
    await processOutbox(pool, mailer, opts);
    await pool.query(`UPDATE outbox_events SET next_attempt_at = now()`);
    expect(await processOutbox(pool, mailer, opts)).toMatchObject({ sent: 1 });
    expect(mailer.sent[0]!.text).toContain('https://nona.vn/dat-lai-mat-khau?token=abc');
    expect((await events())[0]).toMatchObject({ status: 'SENT', payload: {} });
  });

  it('dead-letters permanently broken events and ignores events that need no email', async () => {
    await enqueue('order.placed', { ...placed('x@example.com', 'AB12CD34EF56'), email: undefined });
    await enqueue('order.status_changed', {
      orderCode: 'AB12CD34EF56',
      email: 'a@example.com',
      customerName: 'A',
      status: 'PROCESSING',
    });
    const stats = await processOutbox(pool, new FakeMailer(), opts);
    expect(stats).toMatchObject({ dead: 1, skipped: 1 });
    const rows = await events();
    expect(rows.map((r) => r.status).sort()).toEqual(['DEAD', 'SENT']);
  });

  it('never double-sends when several workers run at once', async () => {
    for (let i = 0; i < 30; i++)
      await enqueue(
        'order.placed',
        placed(`u${i}@example.com`, `AB12CD34EF${String(i).padStart(2, '0')}`),
      );
    const mailer = new FakeMailer();
    await Promise.all([
      processOutbox(pool, mailer, opts),
      processOutbox(pool, mailer, opts),
      processOutbox(pool, mailer, opts),
    ]);
    await processOutbox(pool, mailer, opts);
    const recipients = mailer.sent.map((m) => m.to);
    expect(new Set(recipients).size).toBe(recipients.length); // no duplicates
    expect(recipients.length).toBe(30);
  });

  it('keeps an event leased (not re-sent) while another worker may still be handling it', async () => {
    await enqueue('order.placed', placed('a@example.com', 'AB12CD34EF56'));
    const slow: Mailer = { send: () => new Promise((r) => setTimeout(r, 300)) };
    const mailer = new FakeMailer();
    await Promise.all([
      processOutbox(pool, slow, opts),
      (async () => {
        await new Promise((r) => setTimeout(r, 100));
        return processOutbox(pool, mailer, opts);
      })(),
    ]);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('internal jobs', () => {
  it('calls the API with the shared token and returns its JSON', async () => {
    const calls: { url: string; token: string }[] = [];
    const fake = async (url: string, init: { headers: Record<string, string> }) => {
      calls.push({ url, token: init.headers['x-internal-token']! });
      return { ok: true, status: 200, json: async () => ({ expired: 2 }) };
    };
    expect(
      await callInternalJob(
        { apiUrl: 'http://api.local', internalToken: 'secret-token-123' },
        'payments-maintenance',
        fake as never,
      ),
    ).toEqual({ expired: 2 });
    expect(calls).toEqual([
      { url: 'http://api.local/v1/internal/jobs/payments-maintenance', token: 'secret-token-123' },
    ]);
  });
  it('does nothing without a token, and survives API errors and network failures', async () => {
    const never = async () => {
      throw new Error('must not be called');
    };
    expect(await callInternalJob({ apiUrl: 'http://x' }, 'job', never as never)).toBeNull();
    expect(
      await callInternalJob({ apiUrl: 'http://x', internalToken: 't' }, 'job', (async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
      })) as never),
    ).toBeNull();
    expect(
      await callInternalJob({ apiUrl: 'http://x', internalToken: 't' }, 'job', (async () => {
        throw new Error('ECONNREFUSED');
      }) as never),
    ).toBeNull();
  });
});

describe('alerts', () => {
  it('reports dead-lettered or stuck events, unresolved refunds and stale payments, and is quiet when healthy', async () => {
    expect(await checkAlerts(pool)).toEqual([]);
    await pool.query(
      `INSERT INTO outbox_events (type, payload, status) VALUES ('order.placed','{}','DEAD')`,
    );
    await pool.query(
      `INSERT INTO outbox_events (type, payload, created_at) VALUES ('order.placed','{}', now() - interval '20 minutes')`,
    );
    expect((await checkAlerts(pool)).map((a) => a.code).sort()).toEqual([
      'OUTBOX_DEAD',
      'OUTBOX_STUCK',
    ]);
  });
});

describe('cleanup', () => {
  it('removes stale guest carts, spent tokens and expired sessions but keeps current data', async () => {
    const u = (
      await pool.query(
        `INSERT INTO users (email, password_hash, full_name) VALUES ('u@example.com','x','U') RETURNING id`,
      )
    ).rows[0].id;
    await pool.query(
      `INSERT INTO carts (guest_token_hash, updated_at) VALUES ('old', now() - interval '31 days'), ('fresh', now())`,
    );
    await pool.query(
      `INSERT INTO carts (user_id, updated_at) VALUES ($1, now() - interval '90 days')`,
      [u],
    );
    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,'old', now() - interval '8 days'), ($1,'live', now() + interval '1 hour')`,
      [u],
    );
    await pool.query(
      `INSERT INTO sessions (user_id, token_hash, csrf_token, expires_at, created_at) VALUES ($1,'a','c', now() - interval '31 days', now() - interval '40 days'), ($1,'b','c', now() + interval '1 day', now())`,
      [u],
    );
    const r = await cleanup(pool);
    expect(r).toMatchObject({ guestCarts: 1, resetTokens: 1, sessions: 1 });
    expect(
      (
        await pool.query(
          'SELECT guest_token_hash, user_id FROM carts ORDER BY guest_token_hash NULLS LAST',
        )
      ).rowCount,
    ).toBe(2);
    expect((await pool.query('SELECT 1 FROM carts WHERE user_id IS NOT NULL')).rowCount).toBe(1); // user carts are never auto-deleted
  });
});

describe('Zalo access token', () => {
  const KEY = Buffer.alloc(32, 9).toString('base64');
  const cfg = (over: object = {}) => ({
    appId: 'app1',
    appSecret: 'secret1',
    encryptionKey: KEY,
    seedRefreshToken: 'refresh-0',
    tokenUrl: 'https://oauth.test/token',
    ...over,
  });
  const fakeZalo = () => {
    const calls: { body: string; secret: string }[] = [];
    let n = 0;
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      n++;
      calls.push({
        body: String(init.body),
        secret: (init.headers as Record<string, string>).secret_key!,
      });
      return new Response(
        JSON.stringify({
          access_token: `access-${n}`,
          refresh_token: `refresh-${n}`,
          expires_in: '90000',
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    return { calls, restore: () => void (globalThis.fetch = real) };
  };

  it('seeds from the first refresh token, refreshes, stores the rotated pair encrypted, and reuses it', async () => {
    const { ZaloTokenProvider } = await import('../src/zalo-token.js');
    await pool.query('DELETE FROM integration_tokens');
    const z = fakeZalo();
    try {
      const provider = new ZaloTokenProvider(pool, cfg());
      expect(await provider.accessToken()).toBe('access-1');
      expect(z.calls[0]!.secret).toBe('secret1');
      expect(z.calls[0]!.body).toContain('refresh_token=refresh-0');
      expect(await provider.accessToken()).toBe('access-1'); // still valid: no second call
      expect(z.calls).toHaveLength(1);
      const row = (await pool.query('SELECT * FROM integration_tokens')).rows[0];
      expect(row.access_token_enc).not.toContain('access-1'); // encrypted at rest
      expect(row.refresh_token_enc).not.toContain('refresh-1');
      expect(await provider.refreshNow()).toBe('access-2');
      expect(z.calls[1]!.body).toContain('refresh_token=refresh-1'); // the rotated token is used next
    } finally {
      z.restore();
    }
  });

  it('retries once with a fresh token when Zalo says the token is invalid', async () => {
    const seen: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      const token = (init.headers as Record<string, string>).access_token!;
      seen.push(token);
      return new Response(
        JSON.stringify(token === 'old' ? { error: -124, message: 'invalid token' } : { error: 0 }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const sender = new ZaloZnsSender({
        accessToken: async () => 'old',
        refreshAccessToken: async () => 'new',
        templateId: '1',
        codeParam: 'otp',
        apiUrl: 'https://zalo.test/x',
      });
      await sender.sendOtp('+84912345678', '123456', 5);
      expect(seen).toEqual(['old', 'new']);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('eSMS sender', () => {
  const cfg = {
    apiKey: 'KEY',
    secretKey: 'SECRET',
    brandname: 'NONA',
    smsType: '2',
    template: DEFAULT_ESMS_TEMPLATE,
    sandbox: false,
    apiUrl: 'https://esms.test/send',
  };
  const answer = (result: object) => {
    const calls: Record<string, string>[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(result), { status: 200 });
    }) as typeof fetch;
    return { calls, restore: () => void (globalThis.fetch = real) };
  };

  it('sends the code with a local phone number, the brandname and a stable request id', async () => {
    const r = answer({ CodeResult: '100', SMSID: 'x' });
    try {
      await new EsmsSender(cfg).sendOtp('+84912345678', '123456', 5, 'evt-1');
      expect(r.calls[0]).toMatchObject({
        ApiKey: 'KEY',
        SecretKey: 'SECRET',
        Phone: '0912345678',
        Brandname: 'NONA',
        SmsType: '2',
        IsUnicode: '0',
        Sandbox: '0',
        RequestId: 'evt-1',
      });
      expect(r.calls[0]!.Content).toBe(
        '123456 la ma xac thuc NONA cua ban. Ma co hieu luc 5 phut. Khong chia se ma nay cho bat ky ai.',
      );
    } finally {
      r.restore();
    }
  });

  it('treats a duplicate request id as already sent, and sandbox as validation only', async () => {
    const r = answer({ CodeResult: '124', ErrorMessage: 'duplicate' });
    try {
      await expect(
        new EsmsSender(cfg).sendOtp('+84912345678', '1', 5, 'evt-1'),
      ).resolves.toBeUndefined();
      await new EsmsSender({ ...cfg, sandbox: true }).sendOtp('+84912345678', '1', 5);
      expect(r.calls[1]!.Sandbox).toBe('1');
    } finally {
      r.restore();
    }
  });

  it('gives up at once on a missing brandname/template and retries on other errors, never leaking keys', async () => {
    for (const [code, kind] of [
      ['104', SmsRejectedError],
      ['146', SmsRejectedError],
      ['101', Error],
    ] as const) {
      const r = answer({ CodeResult: code, ErrorMessage: 'nope' });
      try {
        const err = await new EsmsSender(cfg).sendOtp('+84912345678', '999999', 5).catch((e) => e);
        expect(err).toBeInstanceOf(kind);
        if (code === '101') expect(err).not.toBeInstanceOf(SmsRejectedError);
        expect(String(err.message)).toContain(`eSMS error ${code}`);
        expect(String(err.message)).not.toMatch(/KEY|SECRET|999999/);
      } finally {
        r.restore();
      }
    }
  });
});
