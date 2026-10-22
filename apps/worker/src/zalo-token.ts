import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';
import { logger } from './logger.js';

export interface ZaloOAuthConfig {
  appId: string;
  appSecret: string;
  /** 32 bytes, base64: encrypts the tokens stored in the database. */
  encryptionKey: string;
  /** Refresh token from the first authorisation (used only to seed the database). */
  seedRefreshToken: string;
  /** Optional access token from the same authorisation. */
  seedAccessToken?: string;
  tokenUrl: string;
}

const PROVIDER = 'zalo';
const REFRESH_MARGIN_MS = 10 * 60_000;

function key(b64: string): Buffer {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('ZALO_TOKEN_KEY must be 32 bytes, base64-encoded');
  return k;
}
export function seal(plain: string, b64Key: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(b64Key), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
export function open(sealed: string, b64Key: string): string {
  const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64')) as [
    Buffer,
    Buffer,
    Buffer,
  ];
  const d = createDecipheriv('aes-256-gcm', key(b64Key), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

/**
 * Keeps a valid Zalo OA access token. The pair (access, refresh) lives encrypted in `integration_tokens`;
 * a row lock makes sure only one worker refreshes at a time (Zalo invalidates the old refresh token the
 * moment a new one is issued, so a lost update would lock the OA out until it is re-authorised).
 */
export class ZaloTokenProvider {
  constructor(
    private readonly pool: pg.Pool,
    private readonly config: ZaloOAuthConfig,
  ) {}

  /** A token that is good for at least a few more minutes. */
  async accessToken(): Promise<string> {
    return this.ensure(false);
  }

  /** Called after Zalo rejected the token: refresh now, even if it looked valid. */
  async refreshNow(): Promise<string> {
    return this.ensure(true);
  }

  private async ensure(force: boolean): Promise<string> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO integration_tokens (provider, access_token_enc, refresh_token_enc, expires_at)
         VALUES ($1, $2, $3, $4) ON CONFLICT (provider) DO NOTHING`,
        [
          PROVIDER,
          seal(this.config.seedAccessToken ?? '', this.config.encryptionKey),
          seal(this.config.seedRefreshToken, this.config.encryptionKey),
          // a seeded access token has unknown age: refresh at once unless it is the only thing we have
          new Date(0),
        ],
      );
      const row = (
        await client.query<{
          access_token_enc: string;
          refresh_token_enc: string;
          expires_at: Date;
        }>(
          'SELECT access_token_enc, refresh_token_enc, expires_at FROM integration_tokens WHERE provider = $1 FOR UPDATE',
          [PROVIDER],
        )
      ).rows[0]!;
      const access = open(row.access_token_enc, this.config.encryptionKey);
      if (!force && access && row.expires_at.getTime() - Date.now() > REFRESH_MARGIN_MS) {
        await client.query('COMMIT');
        return access;
      }
      const refreshed = await this.callZalo(open(row.refresh_token_enc, this.config.encryptionKey));
      await client.query(
        `UPDATE integration_tokens SET access_token_enc = $2, refresh_token_enc = $3, expires_at = $4, updated_at = now()
         WHERE provider = $1`,
        [
          PROVIDER,
          seal(refreshed.accessToken, this.config.encryptionKey),
          seal(refreshed.refreshToken, this.config.encryptionKey),
          new Date(Date.now() + refreshed.expiresInSeconds * 1000),
        ],
      );
      await client.query('COMMIT');
      logger.info({ expiresInSeconds: refreshed.expiresInSeconds }, 'Zalo access token refreshed');
      return refreshed.accessToken;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  private async callZalo(refreshToken: string) {
    const res = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        secret_key: this.config.appSecret,
      },
      body: new URLSearchParams({
        app_id: this.config.appId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: string | number;
      error?: number;
      error_name?: string;
      error_reason?: string;
    } | null;
    if (!res.ok || !body?.access_token || !body.refresh_token) {
      // never include tokens in the message
      throw new Error(
        `Zalo token refresh failed (${body?.error ?? res.status} ${body?.error_name ?? ''}): ${body?.error_reason ?? 'no response'}. The OA may need to be authorised again.`,
      );
    }
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresInSeconds: Number(body.expires_in) > 0 ? Number(body.expires_in) : 3600,
    };
  }
}
