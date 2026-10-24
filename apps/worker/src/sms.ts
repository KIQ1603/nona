import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/** Port: the worker depends on this, never on a vendor API. */
export interface SmsSender {
  /** `requestId` is stable per message (the outbox event id), so a retry never sends a second SMS. */
  sendOtp(phoneE164: string, code: string, ttlMinutes: number, requestId?: string): Promise<void>;
}

/** The message was refused for a reason that retrying cannot fix (e.g. the number is not on Zalo). */
export class SmsRejectedError extends Error {}

export interface ZaloZnsConfig {
  /** Returns a valid access token (refreshing it when needed) */
  accessToken: () => Promise<string>;
  /** Gets a new token after Zalo said the old one is no longer valid. Optional (static-token mode). */
  refreshAccessToken?: () => Promise<string>;
  templateId: string;
  /** Name of the OTP variable in the approved ZNS template. */
  codeParam: string;
  /** Extra template variable that receives the validity in minutes, if the template has one. */
  ttlParam?: string;
  apiUrl: string;
  /** 'development' sends test messages (no charge, only to the OA/app testers) before the template is approved. */
  mode?: string;
}

/** The access token was refused (expired or revoked). */
class ZaloAuthError extends Error {}

/** Zalo error codes that mean "do not retry": the template/number/payload is wrong, not a transient fault. */
const PERMANENT = new Set([-118, -119, -120, -128, -131, -132, -133, -134, -135, -138]);

/** Sends the OTP as a Zalo Notification Service (ZNS) template message. */
export class ZaloZnsSender implements SmsSender {
  constructor(private readonly config: ZaloZnsConfig) {}

  async sendOtp(phoneE164: string, code: string, ttlMinutes: number): Promise<void> {
    try {
      await this.send(phoneE164, code, ttlMinutes, await this.config.accessToken());
    } catch (e) {
      if (!(e instanceof ZaloAuthError) || !this.config.refreshAccessToken) throw e;
      // the token expired or was revoked: get a new one and try once more
      await this.send(phoneE164, code, ttlMinutes, await this.config.refreshAccessToken());
    }
  }

  private async send(
    phoneE164: string,
    code: string,
    ttlMinutes: number,
    token: string,
  ): Promise<void> {
    const templateData: Record<string, string> = { [this.config.codeParam]: code };
    if (this.config.ttlParam) templateData[this.config.ttlParam] = String(ttlMinutes);
    const res = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json', access_token: token },
      body: JSON.stringify({
        phone: phoneE164.replace(/^\+/, ''), // Zalo wants 84912345678
        template_id: this.config.templateId,
        template_data: templateData,
        tracking_id: randomUUID(),
        ...(this.config.mode ? { mode: this.config.mode } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      error?: number;
      message?: string;
    } | null;
    if (!res.ok || !body || body.error !== 0) {
      const code = body?.error ?? res.status;
      const message = `Zalo ZNS error ${code}: ${body?.message ?? 'no response body'}`;
      // never log the OTP itself
      if (code === -124 || code === -216) throw new ZaloAuthError(message);
      if (typeof code === 'number' && PERMANENT.has(code)) throw new SmsRejectedError(message);
      throw new Error(message);
    }
  }
}

/** Development only: nothing is sent, the code is written to the worker log. */
export class SimulatorSmsSender implements SmsSender {
  async sendOtp(phoneE164: string, code: string): Promise<void> {
    logger.warn({ phone: phoneE164, code }, '[SMS simulator] OTP not sent, use this code');
  }
}

export interface EsmsConfig {
  apiKey: string;
  secretKey: string;
  /** Sender name registered (and approved) at eSMS. */
  brandname: string;
  /** "2" = customer care (OTP) with a registered brandname and template. */
  smsType: string;
  /** Message text with {code} and {minutes}; it must match the template registered at eSMS. */
  template: string;
  /** "1" validates the request without sending or charging (testing). */
  sandbox: boolean;
  apiUrl: string;
}

/** Message text without diacritics: plain GSM text is cheaper and what eSMS templates usually are. */
export const DEFAULT_ESMS_TEMPLATE =
  '{code} la ma xac thuc NONA cua ban. Ma co hieu luc {minutes} phut. Khong chia se ma nay cho bat ky ai.';

/** Sends the OTP as an SMS through eSMS.vn (SendMultipleMessage_V4_post_json). */
export class EsmsSender implements SmsSender {
  constructor(private readonly config: EsmsConfig) {}

  async sendOtp(
    phoneE164: string,
    code: string,
    ttlMinutes: number,
    requestId?: string,
  ): Promise<void> {
    const res = await fetch(this.config.apiUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ApiKey: this.config.apiKey,
        SecretKey: this.config.secretKey,
        Phone: phoneE164.replace(/^\+84/, '0'),
        Content: this.config.template
          .replace('{code}', code)
          .replace('{minutes}', String(ttlMinutes)),
        Brandname: this.config.brandname,
        SmsType: this.config.smsType,
        IsUnicode: '0',
        Sandbox: this.config.sandbox ? '1' : '0',
        campaignid: 'nona-otp',
        ...(requestId ? { RequestId: requestId.slice(0, 50) } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      CodeResult?: string | number;
      ErrorMessage?: string;
    } | null;
    const result = String(body?.CodeResult ?? res.status);
    // 100 = accepted, 124 = this RequestId was already sent (a retry): both mean the message is out
    if (result === '100' || result === '124') return;
    // never log the code or the keys
    const message = `eSMS error ${result}: ${body?.ErrorMessage ?? 'no response body'}`;
    // wrong brandname / unregistered template: retrying cannot help, the configuration has to be fixed
    if (result === '104' || result === '146') throw new SmsRejectedError(message);
    throw new Error(message);
  }
}
