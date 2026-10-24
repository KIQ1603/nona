import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { normalizeVnMobile, type FirebaseWebConfig } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';

/** The sign-in must be this recent: it is the moment the person typed the SMS code. */
const MAX_AUTH_AGE_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 60;
const KEYS_TTL_MS = 3_600_000;

interface Jwk extends JsonWebKey {
  kid?: string;
}
const invalid = (why: string) =>
  new AppError(
    'TOKEN_INVALID',
    400,
    'Xác thực số điện thoại không hợp lệ hoặc đã hết hạn. Hãy thử lại.',
    {
      reason: why,
    },
  );

const json = <T>(part: string): T | null => {
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
};

/**
 * Phone verification done by Firebase Phone Auth. Firebase texts the code and checks it in the browser; what
 * reaches us is the Firebase ID token. We trust nothing the browser says: the token's RS256 signature is
 * checked against Google's published keys, together with issuer, audience, expiry, freshness and the sign-in
 * provider, and the phone number is read from the token itself.
 */
@Injectable()
export class FirebasePhoneService {
  private keys = new Map<string, Jwk>();
  private keysAt = 0;

  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.FIREBASE_PROJECT_ID);
  }

  /** The public web config of the Firebase app (safe to hand to the browser). */
  webConfig(): FirebaseWebConfig | null {
    const e = this.env;
    if (
      !e.FIREBASE_PROJECT_ID ||
      !e.FIREBASE_API_KEY ||
      !e.FIREBASE_AUTH_DOMAIN ||
      !e.FIREBASE_APP_ID
    )
      return null;
    return {
      apiKey: e.FIREBASE_API_KEY,
      authDomain: e.FIREBASE_AUTH_DOMAIN,
      projectId: e.FIREBASE_PROJECT_ID,
      appId: e.FIREBASE_APP_ID,
    };
  }

  private async loadKeys(): Promise<void> {
    const res = await fetch(this.env.FIREBASE_JWKS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Firebase keys answered ${res.status}`);
    const body = (await res.json()) as { keys?: Jwk[] };
    this.keys = new Map((body.keys ?? []).filter((k) => k.kid).map((k) => [k.kid!, k]));
    this.keysAt = Date.now();
  }

  private async keyFor(kid: string): Promise<Jwk | undefined> {
    if (Date.now() - this.keysAt > KEYS_TTL_MS) await this.loadKeys();
    // a key that is not cached may be brand new: refresh at most once a minute
    if (!this.keys.has(kid) && Date.now() - this.keysAt > 60_000) await this.loadKeys();
    return this.keys.get(kid);
  }

  /** Returns the verified number in +84… form. Throws TOKEN_INVALID for anything wrong with the token. */
  async verifyIdToken(idToken: string): Promise<string> {
    if (!this.enabled) throw new AppError('NOT_FOUND', 404, 'Xác thực qua Firebase chưa được bật.');
    const projectId = this.env.FIREBASE_PROJECT_ID!;
    const parts = idToken.split('.');
    if (parts.length !== 3) throw invalid('format');
    const [h, p, sig] = parts as [string, string, string];
    const header = json<{ alg?: string; kid?: string }>(h);
    const claims = json<{
      iss?: string;
      aud?: string;
      sub?: string;
      exp?: number;
      iat?: number;
      auth_time?: number;
      phone_number?: string;
      firebase?: { sign_in_provider?: string };
    }>(p);
    if (!header || !claims || header.alg !== 'RS256' || !header.kid) throw invalid('header');

    let jwk: Jwk | undefined;
    try {
      jwk = await this.keyFor(header.kid);
    } catch {
      throw new AppError(
        'INTERNAL_ERROR',
        503,
        'Không thể kiểm tra xác thực lúc này. Hãy thử lại sau.',
      );
    }
    if (!jwk) throw invalid('kid');
    const ok = verify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(sig, 'base64url'),
    );
    if (!ok) throw invalid('signature');

    const now = Math.floor(Date.now() / 1000);
    if (claims.iss !== `https://securetoken.google.com/${projectId}`) throw invalid('iss');
    if (claims.aud !== projectId) throw invalid('aud');
    if (!claims.sub) throw invalid('sub');
    if (typeof claims.exp !== 'number' || claims.exp <= now) throw invalid('exp');
    if (typeof claims.iat !== 'number' || claims.iat > now + CLOCK_SKEW_SECONDS)
      throw invalid('iat');
    if (typeof claims.auth_time !== 'number' || claims.auth_time > now + CLOCK_SKEW_SECONDS)
      throw invalid('auth_time');
    if (now - claims.auth_time > MAX_AUTH_AGE_SECONDS) throw invalid('stale');
    if (claims.firebase?.sign_in_provider !== 'phone') throw invalid('provider');
    const phone = claims.phone_number ? normalizeVnMobile(claims.phone_number) : null;
    if (!phone) throw invalid('phone');
    return phone;
  }
}
