import { randomUUID } from 'node:crypto';
import { logger } from './logger.js';

/** Port: the worker depends on this, never on a vendor API. */
export interface SmsSender {
  sendOtp(phoneE164: string, code: string, ttlMinutes: number): Promise<void>;
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
