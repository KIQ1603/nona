import type { SmtpConfig } from '@nona/mail';

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`);
  return n;
}

export function loadConfig() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const smtp: SmtpConfig = {
    host: process.env.SMTP_HOST ?? 'localhost',
    port: int('SMTP_PORT', 1025),
    from: process.env.SMTP_FROM ?? 'NONA <no-reply@nona.local>',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  };
  const smsMode = process.env.SMS_MODE ?? 'simulator';
  if (smsMode !== 'simulator' && smsMode !== 'zalo' && smsMode !== 'esms')
    throw new Error('SMS_MODE must be simulator, zalo or esms');
  // with Firebase Phone Auth the API never queues a code, so the simulator cannot swallow one
  if (
    process.env.NODE_ENV === 'production' &&
    smsMode === 'simulator' &&
    !process.env.FIREBASE_PROJECT_ID
  )
    throw new Error('the SMS simulator must not run in production');
  if (smsMode === 'zalo') {
    if (!process.env.ZALO_ZNS_TEMPLATE_ID)
      throw new Error('ZALO_ZNS_TEMPLATE_ID is required when SMS_MODE=zalo');
    const oauth = ['ZALO_APP_ID', 'ZALO_APP_SECRET', 'ZALO_OA_REFRESH_TOKEN', 'ZALO_TOKEN_KEY'];
    const have = oauth.filter((k) => process.env[k]);
    if (have.length > 0 && have.length < oauth.length)
      throw new Error(`Zalo OAuth needs all of: ${oauth.join(', ')}`);
    if (have.length === 0 && !process.env.ZALO_ZNS_ACCESS_TOKEN)
      throw new Error(
        'SMS_MODE=zalo needs ZALO_ZNS_ACCESS_TOKEN or the Zalo OAuth variables (recommended)',
      );
  }
  return {
    databaseUrl,
    smsMode: smsMode as 'simulator' | 'zalo' | 'esms',
    esms: {
      apiKey: process.env.ESMS_API_KEY ?? '',
      secretKey: process.env.ESMS_SECRET_KEY ?? '',
      brandname: process.env.ESMS_BRANDNAME ?? '',
      smsType: process.env.ESMS_SMS_TYPE ?? '2',
      template: process.env.ESMS_OTP_TEMPLATE || undefined,
      sandbox: process.env.ESMS_SANDBOX === '1',
      apiUrl:
        process.env.ESMS_API_URL ??
        'https://rest.esms.vn/MainService.svc/json/SendMultipleMessage_V4_post_json/',
    },
    zalo: {
      staticAccessToken: process.env.ZALO_ZNS_ACCESS_TOKEN,
      oauth: process.env.ZALO_APP_ID
        ? {
            appId: process.env.ZALO_APP_ID,
            appSecret: process.env.ZALO_APP_SECRET ?? '',
            encryptionKey: process.env.ZALO_TOKEN_KEY ?? '',
            seedRefreshToken: process.env.ZALO_OA_REFRESH_TOKEN ?? '',
            seedAccessToken: process.env.ZALO_ZNS_ACCESS_TOKEN,
            tokenUrl: process.env.ZALO_OAUTH_URL ?? 'https://oauth.zaloapp.com/v4/oa/access_token',
          }
        : null,
      templateId: process.env.ZALO_ZNS_TEMPLATE_ID ?? '',
      codeParam: process.env.ZALO_ZNS_CODE_PARAM ?? 'otp',
      ttlParam: process.env.ZALO_ZNS_TTL_PARAM,
      mode: process.env.ZALO_ZNS_MODE || undefined,
      apiUrl: process.env.ZALO_ZNS_API_URL ?? 'https://business.openapi.zalo.me/message/template',
    },
    smtp,
    webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:3100',
    /** Internal address of the API, used to trigger payment reconciliation and expiry (logic lives in the API). */
    apiUrl: (
      process.env.INTERNAL_API_URL ??
      process.env.API_PUBLIC_URL ??
      'http://localhost:4100'
    ).replace(/\/$/, ''),
    internalToken: process.env.INTERNAL_API_TOKEN,
    maintenanceEveryMs: int('WORKER_MAINTENANCE_MS', 30_000),
    tickMs: int('WORKER_TICK_MS', 5_000),
    cleanupEveryMs: int('WORKER_CLEANUP_MS', 3_600_000),
  };
}
