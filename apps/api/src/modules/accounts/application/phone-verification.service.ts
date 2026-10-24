import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { OTP_LENGTH, type PhoneOtpSent, type PhoneStatus } from '@nona/contracts';
import type pg from 'pg';
import { AppError } from '../../../common/errors/app-error';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { hashToken } from '../../cart/infrastructure/cart.repository';
import { FirebasePhoneService } from './firebase-phone.service';

export const OTP_TTL_SECONDS = 300;
export const OTP_RESEND_SECONDS = 60;
/** A guest's proof of a phone number lasts this long (it is tied to their browser's cart cookie). */
export const GUEST_PROOF_HOURS = 24;
const MAX_ATTEMPTS = 5;
const MAX_SENDS_PER_HOUR = 5;
const MAX_SENDS_PER_DAY = 10;
const MAX_SENDS_PER_IP_HOUR = 15;

/** +84912345678 -> +84 *** *** 678 */
export const maskPhone = (p: string) => `+84 *** *** ${p.slice(-3)}`;

/** Who is proving the number: a signed-in account or an anonymous browser (its cart cookie). */
export type PhoneOwner = { userId: string } | { guestToken: string };
export type OtpPurpose = 'ACCOUNT' | 'CHECKOUT';
interface Ctx {
  requestId?: string;
  ip?: string;
}
type Q = Pick<pg.PoolClient, 'query'>;

const ownerCol = (o: PhoneOwner): [col: 'user_id' | 'guest_token_hash', value: string] =>
  'userId' in o ? ['user_id', o.userId] : ['guest_token_hash', hashToken(o.guestToken)];

/**
 * One-time code (OTP) verification of a phone number, for an account's profile or for checkout. The code
 * is random, valid 5 minutes, stored only as a keyed hash, limited to 5 wrong tries and single use; sends
 * are rate-limited per owner, per number and per IP. The message goes out through the outbox (Zalo ZNS).
 */
@Injectable()
export class PhoneVerificationService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    @Inject(FirebasePhoneService) private readonly firebase: FirebasePhoneService,
  ) {}

  private hash(code: string, phone: string, owner: PhoneOwner) {
    const [col, val] = ownerCol(owner);
    return createHmac('sha256', this.env.OTP_SECRET)
      .update(`${col}:${val}:${phone}:${code}`)
      .digest('hex');
  }

  async status(userId: string): Promise<PhoneStatus> {
    const { rows } = await this.db.query<{ phone: string | null; phone_verified_at: Date | null }>(
      'SELECT phone, phone_verified_at FROM users WHERE id = $1',
      [userId],
    );
    const r = rows[0];
    return { phone: r?.phone ? maskPhone(r.phone) : null, verified: Boolean(r?.phone_verified_at) };
  }

  /** Has this buyer proven they control the number? (account phone, an earlier checkout proof, or a guest proof < 24h) */
  async isVerified(q: Q, owner: PhoneOwner, phone: string): Promise<boolean> {
    if ('userId' in owner) {
      const r = await q.query(
        `SELECT 1 FROM users WHERE id = $1 AND phone = $2 AND phone_verified_at IS NOT NULL
         UNION ALL SELECT 1 FROM verified_phones WHERE user_id = $1 AND phone = $2 LIMIT 1`,
        [owner.userId, phone],
      );
      return Boolean(r.rowCount);
    }
    const r = await q.query(
      `SELECT 1 FROM verified_phones WHERE guest_token_hash = $1 AND phone = $2
         AND verified_at > now() - make_interval(hours => $3)`,
      [hashToken(owner.guestToken), phone, GUEST_PROOF_HOURS],
    );
    return Boolean(r.rowCount);
  }

  isVerifiedNow(owner: PhoneOwner, phone: string) {
    return this.isVerified(this.db.pool, owner, phone);
  }

  async request(
    owner: PhoneOwner,
    phone: string,
    purpose: OtpPurpose,
    ctx: Ctx = {},
  ): Promise<PhoneOtpSent> {
    if (this.firebase.enabled)
      throw new AppError(
        'CONFLICT',
        409,
        'Số điện thoại được xác thực qua Firebase, không gửi mã từ máy chủ.',
      );
    const [col, val] = ownerCol(owner);
    const sent = await this.db.transaction(async (c) => {
      // serialise requests of one owner so the limits cannot be raced
      if ('userId' in owner) await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [val]);
      else await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [val]);

      if (await this.isVerified(c, owner, phone))
        throw new AppError('CONFLICT', 409, 'Số điện thoại này đã được xác thực.');
      if (purpose === 'ACCOUNT' && 'userId' in owner) {
        const taken = await c.query(
          'SELECT 1 FROM users WHERE phone = $1 AND phone_verified_at IS NOT NULL AND id <> $2',
          [phone, owner.userId],
        );
        if (taken.rowCount)
          throw new AppError('CONFLICT', 409, 'Số điện thoại này đã được dùng cho tài khoản khác.');
      }

      const last = (
        await c.query<{ wait: number }>(
          `SELECT GREATEST(0, CEIL(EXTRACT(EPOCH FROM (created_at + make_interval(secs => $2) - now()))))::int AS wait
           FROM phone_otps WHERE ${col} = $1 ORDER BY created_at DESC LIMIT 1`,
          [val, OTP_RESEND_SECONDS],
        )
      ).rows[0];
      if (last && last.wait > 0)
        throw new AppError('RATE_LIMITED', 429, `Vui lòng đợi ${last.wait} giây rồi gửi lại mã.`, {
          retryAfterSeconds: last.wait,
        });
      const counts = (
        await c.query<{ hour: number; day: number; phone_hour: number; ip_hour: number }>(
          `SELECT COUNT(*) FILTER (WHERE ${col} = $1 AND created_at > now() - interval '1 hour')::int AS hour,
                  COUNT(*) FILTER (WHERE ${col} = $1)::int AS day,
                  COUNT(*) FILTER (WHERE phone = $2 AND created_at > now() - interval '1 hour')::int AS phone_hour,
                  COUNT(*) FILTER (WHERE $3::text IS NOT NULL AND ip = $3 AND created_at > now() - interval '1 hour')::int AS ip_hour
           FROM phone_otps WHERE created_at > now() - interval '1 day'`,
          [val, phone, ctx.ip ?? null],
        )
      ).rows[0]!;
      if (
        counts.hour >= MAX_SENDS_PER_HOUR ||
        counts.day >= MAX_SENDS_PER_DAY ||
        counts.phone_hour >= MAX_SENDS_PER_HOUR ||
        counts.ip_hour >= MAX_SENDS_PER_IP_HOUR
      )
        throw new AppError(
          'RATE_LIMITED',
          429,
          'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.',
        );

      await c.query(
        `UPDATE phone_otps SET consumed_at = now() WHERE ${col} = $1 AND consumed_at IS NULL`,
        [val],
      );
      const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
      await c.query(
        `INSERT INTO phone_otps (${col}, phone, code_hash, purpose, ip, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + make_interval(secs => $6))`,
        [val, phone, this.hash(code, phone, owner), purpose, ctx.ip ?? null, OTP_TTL_SECONDS],
      );
      await enqueueOutbox(c, 'phone.otp', {
        phone,
        code,
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
        ttlMinutes: OTP_TTL_SECONDS / 60,
      });
      await this.audit.record(
        {
          actorId: 'userId' in owner ? owner.userId : undefined,
          action: 'account.phone_otp_sent',
          metadata: { phone: maskPhone(phone), purpose },
          requestId: ctx.requestId,
        },
        c,
      );
      return code;
    });
    return {
      phone: maskPhone(phone),
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: OTP_RESEND_SECONDS,
      ...(this.env.SMS_MODE === 'simulator' && this.env.NODE_ENV !== 'production'
        ? { devCode: sent }
        : {}),
    };
  }

  async verify(
    owner: PhoneOwner,
    code: string,
    purpose: OtpPurpose,
    ctx: Ctx = {},
  ): Promise<PhoneStatus & { rawPhone: string }> {
    const [col, val] = ownerCol(owner);
    // a wrong code must still be counted, so the failure is returned (committing the counter) and thrown afterwards
    const outcome = await this.db.transaction<(PhoneStatus & { rawPhone: string }) | AppError>(
      async (c) => {
        if ('userId' in owner)
          await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [val]);
        else await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [val]);
        const otp = (
          await c.query<{
            id: string;
            phone: string;
            code_hash: string;
            attempts: number;
            purpose: string;
          }>(
            `SELECT id, phone, code_hash, attempts, purpose FROM phone_otps
           WHERE ${col} = $1 AND consumed_at IS NULL AND expires_at > now()
           ORDER BY created_at DESC LIMIT 1`,
            [val],
          )
        ).rows[0];
        if (!otp || otp.purpose !== purpose)
          return new AppError(
            'TOKEN_INVALID',
            400,
            'Mã đã hết hạn hoặc chưa được gửi. Hãy gửi lại mã mới.',
          );
        const given = Buffer.from(this.hash(code, otp.phone, owner));
        const stored = Buffer.from(otp.code_hash);
        if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
          const attempts = otp.attempts + 1;
          await c.query(
            'UPDATE phone_otps SET attempts = $2::int, consumed_at = CASE WHEN $2::int >= $3::int THEN now() ELSE NULL END WHERE id = $1',
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
        await c.query('UPDATE phone_otps SET consumed_at = now() WHERE id = $1', [otp.id]);
        return this.applyProof(c, owner, otp.phone, purpose, 'otp', ctx);
      },
    );
    if (outcome instanceof AppError) throw outcome;
    return outcome;
  }

  /** Firebase already checked the code in the browser; we check its signed token and record the proof. */
  async verifyFirebase(
    owner: PhoneOwner,
    idToken: string,
    purpose: OtpPurpose,
    ctx: Ctx = {},
  ): Promise<PhoneStatus & { rawPhone: string }> {
    const phone = await this.firebase.verifyIdToken(idToken);
    const [, val] = ownerCol(owner);
    const outcome = await this.db.transaction<(PhoneStatus & { rawPhone: string }) | AppError>(
      async (c) => {
        if ('userId' in owner)
          await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [val]);
        else await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [val]);
        return this.applyProof(c, owner, phone, purpose, 'firebase', ctx);
      },
    );
    if (outcome instanceof AppError) throw outcome;
    return outcome;
  }

  /** Records that the owner controls the number: on the account, or as a checkout proof. */
  private async applyProof(
    c: pg.PoolClient,
    owner: PhoneOwner,
    phone: string,
    purpose: OtpPurpose,
    method: 'otp' | 'firebase',
    ctx: Ctx,
  ): Promise<(PhoneStatus & { rawPhone: string }) | AppError> {
    const [col, val] = ownerCol(owner);
    if (purpose === 'ACCOUNT' && 'userId' in owner) {
      try {
        await c.query('UPDATE users SET phone = $2, phone_verified_at = now() WHERE id = $1', [
          owner.userId,
          phone,
        ]);
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          return new AppError(
            'CONFLICT',
            409,
            'Số điện thoại này đã được dùng cho tài khoản khác.',
          );
        throw e;
      }
    } else {
      await c.query(
        `INSERT INTO verified_phones (phone, ${col}) VALUES ($1, $2)
         ON CONFLICT (${col}, phone) WHERE ${col} IS NOT NULL DO UPDATE SET verified_at = now()`,
        [phone, val],
      );
    }
    await this.audit.record(
      {
        actorId: 'userId' in owner ? owner.userId : undefined,
        action: 'account.phone_verified',
        metadata: { phone: maskPhone(phone), purpose, method },
        requestId: ctx.requestId,
      },
      c,
    );
    return { phone: maskPhone(phone), verified: true, rawPhone: phone };
  }

  async remove(userId: string, ctx: Ctx = {}): Promise<PhoneStatus> {
    await this.db.query('UPDATE users SET phone = NULL, phone_verified_at = NULL WHERE id = $1', [
      userId,
    ]);
    await this.audit.record({
      actorId: userId,
      action: 'account.phone_removed',
      requestId: ctx.requestId,
    });
    return { phone: null, verified: false };
  }
}
