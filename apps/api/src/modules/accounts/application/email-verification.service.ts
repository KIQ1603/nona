import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OTP_LENGTH } from '@nona/contracts';
import type pg from 'pg';
import { AppError } from '../../../common/errors/app-error';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';

export const EMAIL_OTP_TTL_SECONDS = 600;
export const EMAIL_OTP_RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;

export interface EmailStatus {
  email: string;
  verified: boolean;
}

/** One-time code that proves the account's email address; the code is mailed by the worker. */
@Injectable()
export class EmailVerificationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private hash(code: string, userId: string, email: string) {
    return createHmac('sha256', this.env.OTP_SECRET)
      .update(`email:${userId}:${email}:${code}`)
      .digest('hex');
  }

  async status(userId: string): Promise<EmailStatus> {
    const { rows } = await this.db.query<{ email: string; email_verified_at: Date | null }>(
      'SELECT email, email_verified_at FROM users WHERE id = $1',
      [userId],
    );
    return { email: rows[0]?.email ?? '', verified: Boolean(rows[0]?.email_verified_at) };
  }

  /** Creates a fresh code inside the caller's transaction (used at sign-up) and returns it for the email. */
  async issue(c: Pick<pg.PoolClient, 'query'>, userId: string, email: string): Promise<string> {
    await c.query(
      'UPDATE email_otps SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL',
      [userId],
    );
    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    await c.query(
      `INSERT INTO email_otps (user_id, email, code_hash, expires_at) VALUES ($1,$2,$3, now() + make_interval(secs => $4))`,
      [userId, email, this.hash(code, userId, email), EMAIL_OTP_TTL_SECONDS],
    );
    return code;
  }

  /** "Send me a code again": rate-limited, the mail goes out through the outbox. */
  async request(userId: string, requestId?: string) {
    const sent = await this.db.transaction(async (c) => {
      const user = (
        await c.query<{ email: string; full_name: string; email_verified_at: Date | null }>(
          'SELECT email, full_name, email_verified_at FROM users WHERE id = $1 FOR UPDATE',
          [userId],
        )
      ).rows[0]!;
      if (user.email_verified_at)
        throw new AppError('CONFLICT', 409, 'Email này đã được xác thực.');
      const last = (
        await c.query<{ wait: number }>(
          `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (created_at + make_interval(secs => $2) - now()))))::int AS wait
           FROM email_otps WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [userId, EMAIL_OTP_RESEND_SECONDS],
        )
      ).rows[0];
      if (last && last.wait > 0)
        throw new AppError('RATE_LIMITED', 429, `Vui lòng đợi ${last.wait} giây rồi gửi lại mã.`, {
          retryAfterSeconds: last.wait,
        });
      const hour = (
        await c.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n FROM email_otps WHERE user_id = $1 AND created_at > now() - interval '1 hour'`,
          [userId],
        )
      ).rows[0]!.n;
      if (hour >= MAX_SENDS_PER_HOUR)
        throw new AppError(
          'RATE_LIMITED',
          429,
          'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.',
        );
      const code = await this.issue(c, userId, user.email);
      await enqueueOutbox(c, 'auth.email_otp', {
        email: user.email,
        fullName: user.full_name,
        code,
        ttlMinutes: EMAIL_OTP_TTL_SECONDS / 60,
      });
      await this.audit.record({ actorId: userId, action: 'account.email_otp_sent', requestId }, c);
      return code;
    });
    return {
      expiresInSeconds: EMAIL_OTP_TTL_SECONDS,
      resendAfterSeconds: EMAIL_OTP_RESEND_SECONDS,
      ...(this.env.SMS_MODE === 'simulator' && this.env.NODE_ENV !== 'production'
        ? { devCode: sent }
        : {}),
    };
  }

  async verify(userId: string, code: string, requestId?: string): Promise<EmailStatus> {
    const outcome = await this.db.transaction<EmailStatus | AppError>(async (c) => {
      const user = (
        await c.query<{ email: string }>('SELECT email FROM users WHERE id = $1 FOR UPDATE', [
          userId,
        ])
      ).rows[0]!;
      const otp = (
        await c.query<{ id: string; code_hash: string; attempts: number; email: string }>(
          `SELECT id, code_hash, attempts, email FROM email_otps
           WHERE user_id = $1 AND consumed_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1`,
          [userId],
        )
      ).rows[0];
      if (!otp || otp.email !== user.email)
        return new AppError(
          'TOKEN_INVALID',
          400,
          'Mã đã hết hạn hoặc chưa được gửi. Hãy gửi lại mã mới.',
        );
      const given = Buffer.from(this.hash(code, userId, otp.email));
      const stored = Buffer.from(otp.code_hash);
      if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
        const attempts = otp.attempts + 1;
        await c.query(
          'UPDATE email_otps SET attempts = $2::int, consumed_at = CASE WHEN $2::int >= $3::int THEN now() ELSE NULL END WHERE id = $1',
          [otp.id, attempts, MAX_ATTEMPTS],
        );
        return new AppError(
          'TOKEN_INVALID',
          400,
          attempts >= MAX_ATTEMPTS
            ? 'Nhập sai quá nhiều lần. Hãy gửi lại mã mới.'
            : `Mã không đúng. Bạn còn ${MAX_ATTEMPTS - attempts} lần thử.`,
          { attemptsLeft: Math.max(0, MAX_ATTEMPTS - attempts) },
        );
      }
      await c.query('UPDATE email_otps SET consumed_at = now() WHERE id = $1', [otp.id]);
      await c.query('UPDATE users SET email_verified_at = now() WHERE id = $1', [userId]);
      await this.audit.record({ actorId: userId, action: 'account.email_verified', requestId }, c);
      return { email: otp.email, verified: true };
    });
    if (outcome instanceof AppError) throw outcome;
    return outcome;
  }
}
