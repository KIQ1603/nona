import { z } from 'zod';

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  WEB_ORIGIN: z.string().url().default('http://localhost:3000'),
  MEDIA_BASE_URL: z.string().url().default('http://localhost:3000/media'),
  STORAGE_DRIVER: z.enum(['s3', 'memory']).default('s3'),
  S3_ENDPOINT: z.string().url().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('nona-media'),
  S3_ACCESS_KEY: z.string().default('nona'),
  S3_SECRET_KEY: z.string().default('nona-secret'),
  API_PUBLIC_URL: z.string().url().default('http://localhost:4100'),
  /** 'simulator' runs a local fake VNPay (development only); 'vnpay' talks to the real sandbox/live gateway. */
  PAYMENTS_MODE: z.enum(['simulator', 'vnpay']).default('simulator'),
  VNPAY_TMN_CODE: z.string().optional(),
  VNPAY_HASH_SECRET: z.string().min(16).optional(),
  VNPAY_PAY_URL: z.string().url().optional(),
  VNPAY_API_URL: z.string().url().optional(),
  /** Shared secret for worker -> API internal job calls and the metrics endpoint. Unset = those endpoints are disabled. */
  INTERNAL_API_TOKEN: z.string().min(24).optional(),
  /** Staff must enrol in TOTP before using the admin area. Enable in production. */
  REQUIRE_STAFF_MFA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** 32 bytes, base64. Encrypts TOTP secrets at rest. */
  MFA_ENCRYPTION_KEY: z.string().optional(),
  /** Reverse proxies in front of the API (each one appends to X-Forwarded-For). Direct = 0, one proxy = 1, Vercel rewrite + a host proxy (Railway, Cloudflare, Nginx) = 2. Wrong values break per-IP rate limits. */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /** 'simulator' prints OTP codes instead of sending them (development only); 'zalo' sends through Zalo ZNS (worker). */
  SMS_MODE: z.enum(['simulator', 'zalo']).default('simulator'),
  /** Keys the hash of one-time codes. Required in production (>= 24 chars). */
  OTP_SECRET: z.string().min(24).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
const DEV_SIM_SECRET = 'nona-simulator-secret-dev-only';
const DEV_MFA_KEY = Buffer.alloc(32, 7).toString('base64');

export const envSchema = baseSchema
  .superRefine((e, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    if (e.NODE_ENV === 'production') {
      if (e.SMS_MODE !== 'zalo') fail('SMS_MODE', 'the SMS simulator must not run in production');
      if (!e.OTP_SECRET) fail('OTP_SECRET', 'is required in production');
      if (e.PAYMENTS_MODE !== 'vnpay')
        fail('PAYMENTS_MODE', 'the payment simulator must not run in production');
      for (const k of [
        'VNPAY_TMN_CODE',
        'VNPAY_HASH_SECRET',
        'VNPAY_PAY_URL',
        'VNPAY_API_URL',
        'INTERNAL_API_TOKEN',
        'MFA_ENCRYPTION_KEY',
      ] as const) {
        if (!e[k]) fail(k, 'is required in production');
      }
    } else if (e.PAYMENTS_MODE === 'vnpay') {
      for (const k of [
        'VNPAY_TMN_CODE',
        'VNPAY_HASH_SECRET',
        'VNPAY_PAY_URL',
        'VNPAY_API_URL',
      ] as const)
        if (!e[k]) fail(k, 'is required when PAYMENTS_MODE=vnpay');
    }
    if (e.MFA_ENCRYPTION_KEY && Buffer.from(e.MFA_ENCRYPTION_KEY, 'base64').length !== 32)
      fail('MFA_ENCRYPTION_KEY', 'must be 32 bytes, base64-encoded');
  })
  .transform((e) => {
    const sim = e.PAYMENTS_MODE === 'simulator';
    return {
      ...e,
      VNPAY_TMN_CODE: e.VNPAY_TMN_CODE ?? 'NONASIM1',
      VNPAY_HASH_SECRET: e.VNPAY_HASH_SECRET ?? DEV_SIM_SECRET,
      VNPAY_PAY_URL: e.VNPAY_PAY_URL ?? (sim ? `${e.WEB_ORIGIN}/dev/vnpay` : ''),
      VNPAY_API_URL:
        e.VNPAY_API_URL ??
        (sim ? `${e.API_PUBLIC_URL}/v1/dev/vnpay/merchant_webapi/api/transaction` : ''),
      MFA_ENCRYPTION_KEY: e.MFA_ENCRYPTION_KEY ?? DEV_MFA_KEY,
      OTP_SECRET: e.OTP_SECRET ?? 'nona-otp-secret-dev-only-0000',
    };
  });
export type Env = z.infer<typeof envSchema>;

export const ENV = Symbol('ENV');

/** Fails fast at boot with a readable message if configuration is invalid. */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration — ${issues}`);
  }
  return parsed.data;
}
