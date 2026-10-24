import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { classifyIdentifier, OTP_LENGTH, type ChallengeSent } from '@nona/contracts';
import type pg from 'pg';
import { AppError } from '../../../common/errors/app-error';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { FirebasePhoneService } from '../../accounts/application/firebase-phone.service';
import { maskPhone } from '../../accounts/application/phone-verification.service';
import { PasswordHasher } from '../infrastructure/password-hasher';
import { AuthService, type LoginContext } from './auth.service';

const EMAIL_TTL_SECONDS = 600;
const PHONE_TTL_SECONDS = 300;
const RESEND_SECONDS = 60;
const MAX_ATTEMPTS = 5;
const MAX_PER_IDENTIFIER_HOUR = 5;
const MAX_PER_IP_HOUR = 15;

type Purpose = 'REGISTER' | 'RESET';
type Channel = 'EMAIL' | 'PHONE';
interface Row {
  id: string;
  purpose: Purpose;
  channel: Channel;
  identifier: string;
  user_id: string | null;
  full_name: string | null;
  password_hash: string | null;
  code_hash: string;
  attempts: number;
}

const maskEmail = (e: string) => {
  const [name = '', domain = ''] = e.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
};

/**
 * One-time codes that are checked BEFORE anything is created or changed: sign-up with an email or a phone
 * number (the account only exists once the code is right) and password reset by phone. Codes are random,
 * stored as a keyed hash, single use, limited to 5 wrong tries and rate-limited per identifier and per IP.
 */
@Injectable()
export class AuthChallengeService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(ENV) private readonly env: Env,
    @Inject(FirebasePhoneService) private readonly firebase: FirebasePhoneService,
  ) {}

  private hash(code: string, id: string) {
    return createHmac('sha256', this.env.OTP_SECRET)
      .update(`challenge:${id}:${code}`)
      .digest('hex');
  }

  private ttl(channel: Channel) {
    return channel === 'EMAIL' ? EMAIL_TTL_SECONDS : PHONE_TTL_SECONDS;
  }

  /** Inserts a challenge, mails/texts the code (through the outbox) and describes it for the client. */
  private async issue(
    c: pg.PoolClient,
    o: {
      purpose: Purpose;
      channel: Channel;
      identifier: string;
      userId?: string | null;
      fullName?: string | null;
      passwordHash?: string | null;
      ip?: string;
      send: boolean;
    },
  ): Promise<ChallengeSent> {
    const hourly = (
      await c.query<{ ident: number; ip: number }>(
        `SELECT COUNT(*) FILTER (WHERE identifier = $1)::int AS ident,
                COUNT(*) FILTER (WHERE $2::text IS NOT NULL AND ip = $2)::int AS ip
         FROM auth_challenges WHERE created_at > now() - interval '1 hour'`,
        [o.identifier, o.ip ?? null],
      )
    ).rows[0]!;
    if (hourly.ident >= MAX_PER_IDENTIFIER_HOUR || hourly.ip >= MAX_PER_IP_HOUR)
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn đã yêu cầu mã quá nhiều lần. Vui lòng thử lại sau.',
      );
    await c.query(
      `UPDATE auth_challenges SET consumed_at = now() WHERE identifier = $1 AND purpose = $2 AND consumed_at IS NULL`,
      [o.identifier, o.purpose],
    );
    const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
    const ttl = this.ttl(o.channel);
    const inserted = await c.query<{ id: string }>(
      `INSERT INTO auth_challenges (purpose, channel, identifier, user_id, full_name, password_hash, code_hash, expires_at, ip)
       VALUES ($1,$2,$3,$4,$5,$6,'pending', now() + make_interval(secs => $7), $8) RETURNING id`,
      [
        o.purpose,
        o.channel,
        o.identifier,
        o.userId ?? null,
        o.fullName ?? null,
        o.passwordHash ?? null,
        ttl,
        o.ip ?? null,
      ],
    );
    const id = inserted.rows[0]!.id;
    await c.query('UPDATE auth_challenges SET code_hash = $2 WHERE id = $1', [
      id,
      this.hash(code, id),
    ]);
    // with Firebase the browser asks Firebase to text the number, so we queue nothing for a phone
    const viaFirebase = o.channel === 'PHONE' && this.firebase.enabled;
    if (o.send && !viaFirebase) {
      if (o.channel === 'EMAIL')
        await enqueueOutbox(c, 'auth.email_otp', {
          email: o.identifier,
          fullName: o.fullName ?? '',
          code,
          ttlMinutes: ttl / 60,
        });
      else
        await enqueueOutbox(c, 'phone.otp', {
          phone: o.identifier,
          code,
          expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
          ttlMinutes: ttl / 60,
        });
    }
    return {
      token: id,
      channel: o.channel,
      destination: o.channel === 'EMAIL' ? maskEmail(o.identifier) : maskPhone(o.identifier),
      expiresInSeconds: ttl,
      resendAfterSeconds: RESEND_SECONDS,
      ...(viaFirebase
        ? { provider: 'firebase' as const }
        : this.env.SMS_MODE === 'simulator' && this.env.NODE_ENV !== 'production'
          ? { devCode: code }
          : {}),
    };
  }

  // ---- sign-up -------------------------------------------------------------------------------------

  async startRegister(
    input: { fullName: string; identifier: string; password: string },
    ctx: LoginContext,
  ): Promise<ChallengeSent> {
    const id = classifyIdentifier(input.identifier);
    if (id.kind === 'INVALID')
      throw AppError.validation({ issues: [{ path: 'identifier', message: id.reason }] });
    const passwordHash = await this.hasher.hash(input.password);
    return this.db.transaction(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id.value]);
      const taken =
        id.kind === 'EMAIL'
          ? await c.query('SELECT 1 FROM users WHERE email = $1', [id.value])
          : await c.query(
              'SELECT 1 FROM users WHERE phone = $1 AND phone_verified_at IS NOT NULL',
              [id.value],
            );
      if (taken.rowCount)
        throw new AppError(
          'CONFLICT',
          409,
          id.kind === 'EMAIL'
            ? 'Email này đã được đăng ký. Hãy đăng nhập hoặc dùng email khác.'
            : 'Số điện thoại này đã được đăng ký. Hãy đăng nhập hoặc dùng số khác.',
          { field: 'identifier' },
        );
      return this.issue(c, {
        purpose: 'REGISTER',
        channel: id.kind,
        identifier: id.value,
        fullName: input.fullName,
        passwordHash,
        ip: ctx.ip,
        send: true,
      });
    });
  }

  /** A new code for the same sign-up (the previous one stops working). */
  async resendRegister(token: string, ctx: LoginContext): Promise<ChallengeSent> {
    return this.db.transaction(async (c) => {
      const old = (
        await c.query<Row & { wait: number }>(
          `SELECT *, GREATEST(0, CEIL(EXTRACT(EPOCH FROM (created_at + make_interval(secs => $2) - now()))))::int AS wait
           FROM auth_challenges WHERE id = $1 AND purpose = 'REGISTER' AND consumed_at IS NULL FOR UPDATE`,
          [token, RESEND_SECONDS],
        )
      ).rows[0];
      if (!old)
        throw new AppError(
          'TOKEN_INVALID',
          400,
          'Phiên đăng ký đã hết hạn. Hãy nhập lại thông tin.',
        );
      if (old.wait > 0)
        throw new AppError('RATE_LIMITED', 429, `Vui lòng đợi ${old.wait} giây rồi gửi lại mã.`, {
          retryAfterSeconds: old.wait,
        });
      return this.issue(c, {
        purpose: 'REGISTER',
        channel: old.channel,
        identifier: old.identifier,
        fullName: old.full_name,
        passwordHash: old.password_hash,
        ip: ctx.ip,
        send: true,
      });
    });
  }

  /** Counts a wrong try (and locks the challenge after 5); returns the error to throw, or null when the code is right. */
  private async checkCode(c: pg.PoolClient, row: Row, code: string): Promise<AppError | null> {
    const given = Buffer.from(this.hash(code, row.id));
    const stored = Buffer.from(row.code_hash);
    if (given.length === stored.length && timingSafeEqual(given, stored)) return null;
    const attempts = row.attempts + 1;
    await c.query(
      'UPDATE auth_challenges SET attempts = $2::int, consumed_at = CASE WHEN $2::int >= $3::int THEN now() ELSE NULL END WHERE id = $1',
      [row.id, attempts, MAX_ATTEMPTS],
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

  /** The proof is a typed code, or (Firebase) the number its signed token vouches for. */
  private async checkProof(
    c: pg.PoolClient,
    row: Row,
    proof: string | { phone: string },
  ): Promise<AppError | null> {
    if (typeof proof === 'string') return this.checkCode(c, row, proof);
    if (row.channel === 'PHONE' && proof.phone === row.identifier) return null;
    return new AppError(
      'TOKEN_INVALID',
      400,
      'Số điện thoại xác thực không khớp với số bạn đã nhập.',
    );
  }

  /** Reads the phone number out of a Firebase ID token (verified), for the *Firebase variants below. */
  verifyFirebaseToken(idToken: string): Promise<string> {
    return this.firebase.verifyIdToken(idToken);
  }

  private async load(c: pg.PoolClient, token: string, purpose: Purpose): Promise<Row | null> {
    return (
      (
        await c.query<Row>(
          `SELECT * FROM auth_challenges WHERE id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now() FOR UPDATE`,
          [token, purpose],
        )
      ).rows[0] ?? null
    );
  }

  /** The right code creates the account and signs the person in. */
  async verifyRegister(token: string, proof: string | { phone: string }, ctx: LoginContext) {
    const expired = () =>
      new AppError(
        'TOKEN_INVALID',
        400,
        'Mã đã hết hạn. Hãy gửi lại mã mới hoặc nhập lại thông tin.',
      );
    const outcome = await this.db.transaction(async (c) => {
      const row = await this.load(c, token, 'REGISTER');
      if (!row) return expired();
      const wrong = await this.checkProof(c, row, proof);
      if (wrong) return wrong;
      // somebody may have registered the same email/phone while the code was pending
      const taken =
        row.channel === 'EMAIL'
          ? await c.query('SELECT 1 FROM users WHERE email = $1', [row.identifier])
          : await c.query(
              'SELECT 1 FROM users WHERE phone = $1 AND phone_verified_at IS NOT NULL',
              [row.identifier],
            );
      if (taken.rowCount)
        return new AppError('CONFLICT', 409, 'Tài khoản này đã được đăng ký. Hãy đăng nhập.', {
          field: 'identifier',
        });
      await c.query('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [row.id]);
      try {
        return await this.auth.createVerifiedCustomer(
          c,
          {
            channel: row.channel,
            identifier: row.identifier,
            fullName: row.full_name ?? row.identifier,
            passwordHash: row.password_hash!,
          },
          ctx,
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          return new AppError('CONFLICT', 409, 'Tài khoản này đã được đăng ký. Hãy đăng nhập.', {
            field: 'identifier',
          });
        throw e;
      }
    });
    if (outcome instanceof AppError) throw outcome;
    return outcome;
  }

  // ---- password reset by phone ---------------------------------------------------------------------

  /** Always answers the same way (no hint whether the number has an account); the SMS only goes to real accounts. */
  async startPhoneReset(phone: string, ctx: LoginContext): Promise<ChallengeSent> {
    return this.db.transaction(async (c) => {
      const user = (
        await c.query<{ id: string }>(
          `SELECT id FROM users WHERE phone = $1 AND phone_verified_at IS NOT NULL AND status = 'ACTIVE'`,
          [phone],
        )
      ).rows[0];
      return this.issue(c, {
        purpose: 'RESET',
        channel: 'PHONE',
        identifier: phone,
        userId: user?.id ?? null,
        ip: ctx.ip,
        send: Boolean(user),
      });
    });
  }

  async verifyPhoneReset(
    token: string,
    proof: string | { phone: string },
    newPassword: string,
    ctx: LoginContext,
  ) {
    const hash = await this.hasher.hash(newPassword);
    const outcome = await this.db.transaction(async (c) => {
      const row = await this.load(c, token, 'RESET');
      if (!row) return new AppError('TOKEN_INVALID', 400, 'Mã đã hết hạn. Hãy yêu cầu mã mới.');
      const wrong = await this.checkProof(c, row, proof);
      if (wrong) return wrong;
      if (!row.user_id)
        return new AppError('TOKEN_INVALID', 400, 'Mã đã hết hạn. Hãy yêu cầu mã mới.');
      const user = (
        await c.query<{ id: string; email: string | null; full_name: string }>(
          'SELECT id, email, full_name FROM users WHERE id = $1',
          [row.user_id],
        )
      ).rows[0]!;
      await c.query('UPDATE auth_challenges SET consumed_at = now() WHERE id = $1', [row.id]);
      await this.auth.applyPasswordReset(
        c,
        { id: user.id, email: user.email, fullName: user.full_name },
        hash,
        ctx,
      );
      return null;
    });
    if (outcome instanceof AppError) throw outcome;
  }
}
