import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ENV, type Env } from '../../../config/env';
import { AppError } from '../../../common/errors/app-error';

export const OAUTH_COOKIE = 'nona_oauth';
const COOKIE_TTL_MS = 10 * 60_000;

/** Reasons the web login page can show after a failed Google sign-in. */
export type GoogleFailure = 'google-huy' | 'google-loi' | 'google-chua-xac-thuc';

export class GoogleFailureError extends Error {
  constructor(readonly code: GoogleFailure) {
    super(code);
  }
}

interface Pending {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  exp: number;
}
export interface GoogleProfile {
  sub: string;
  email: string;
  name: string;
}

const b64 = (b: Buffer) => b.toString('base64url');

/**
 * Google sign-in with the OAuth 2.0 authorization-code flow + PKCE. The state, PKCE verifier and nonce live
 * in a short-lived signed HttpOnly cookie; the token endpoint is called server to server.
 */
@Injectable()
export class GoogleAuthService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get enabled(): boolean {
    return Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET);
  }

  /** Where Google sends the user back: on the web origin, so the cookies are first-party. */
  get redirectUri(): string {
    return `${this.env.WEB_ORIGIN.replace(/\/$/, '')}/api/auth/google/callback`;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.env.OTP_SECRET).update(`oauth:${payload}`).digest('base64url');
  }

  private seal(p: Pending): string {
    const body = Buffer.from(JSON.stringify(p)).toString('base64url');
    return `${body}.${this.sign(body)}`;
  }

  private unseal(value: string | undefined): Pending | null {
    if (!value) return null;
    const [body, sig] = value.split('.');
    if (!body || !sig) return null;
    const expected = Buffer.from(this.sign(body));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    try {
      const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Pending;
      return p.exp > Date.now() ? p : null;
    } catch {
      return null;
    }
  }

  /** Builds the Google consent URL and the cookie that must come back with the callback. */
  start(next: string): { url: string; cookie: string; maxAgeMs: number } {
    if (!this.enabled) throw AppError.notFound();
    const pending: Pending = {
      state: b64(randomBytes(24)),
      verifier: b64(randomBytes(48)),
      nonce: b64(randomBytes(16)),
      next,
      exp: Date.now() + COOKIE_TTL_MS,
    };
    const url = new URL(this.env.GOOGLE_AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_CLIENT_ID!,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: pending.state,
      nonce: pending.nonce,
      code_challenge: b64(createHash('sha256').update(pending.verifier).digest()),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return { url: url.toString(), cookie: this.seal(pending), maxAgeMs: COOKIE_TTL_MS };
  }

  /** Checks the callback against the cookie, trades the code for an ID token and returns the verified profile. */
  async finish(
    query: { code?: string; state?: string; error?: string },
    cookie: string | undefined,
  ): Promise<{ profile: GoogleProfile; next: string }> {
    if (!this.enabled) throw AppError.notFound();
    if (query.error)
      throw new GoogleFailureError(query.error === 'access_denied' ? 'google-huy' : 'google-loi');
    const pending = this.unseal(cookie);
    const stateOk =
      pending &&
      query.state &&
      query.state.length === pending.state.length &&
      timingSafeEqual(Buffer.from(query.state), Buffer.from(pending.state));
    if (!pending || !stateOk || !query.code) throw new GoogleFailureError('google-loi');

    let body: { id_token?: string } | null = null;
    try {
      const res = await fetch(this.env.GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: query.code,
          client_id: this.env.GOOGLE_CLIENT_ID!,
          client_secret: this.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: this.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: pending.verifier,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      body = res.ok ? ((await res.json()) as { id_token?: string }) : null;
    } catch {
      body = null;
    }
    if (!body?.id_token) throw new GoogleFailureError('google-loi');

    // The ID token came straight from Google's token endpoint over TLS, so (as OpenID Connect allows) its
    // claims are checked instead of re-verifying the signature.
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(
        Buffer.from(body.id_token.split('.')[1] ?? '', 'base64url').toString('utf8'),
      );
    } catch {
      throw new GoogleFailureError('google-loi');
    }
    const issuerOk =
      claims.iss === 'https://accounts.google.com' || claims.iss === 'accounts.google.com';
    const audOk = claims.aud === this.env.GOOGLE_CLIENT_ID;
    const fresh = typeof claims.exp === 'number' && claims.exp * 1000 > Date.now();
    if (
      !issuerOk ||
      !audOk ||
      !fresh ||
      claims.nonce !== pending.nonce ||
      typeof claims.sub !== 'string' ||
      typeof claims.email !== 'string'
    )
      throw new GoogleFailureError('google-loi');
    if (claims.email_verified !== true) throw new GoogleFailureError('google-chua-xac-thuc');
    return {
      profile: {
        sub: claims.sub,
        email: claims.email,
        name: typeof claims.name === 'string' ? claims.name : '',
      },
      next: pending.next,
    };
  }
}
