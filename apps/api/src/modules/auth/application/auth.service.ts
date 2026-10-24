import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { ROLE_PERMISSIONS, type MeDto, type UserRole } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { AppError } from '../../../common/errors/app-error';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { DatabaseService } from '../../../platform/database/database.service';
import { ENV, type Env } from '../../../config/env';
import { MfaService } from '../../mfa/application/mfa.service';
import { AuditService } from '../../audit/application/audit.service';
import { LoginThrottle } from '../infrastructure/login-throttle';
import { PasswordHasher } from '../infrastructure/password-hasher';

export const SESSION_COOKIE = 'nona_session';
// Staff sessions are short; customers stay signed in much longer (browsing/cart convenience).
const TTL = {
  staff: { absoluteMs: 7 * 24 * 3_600_000, idleMs: 12 * 3_600_000 },
  customer: { absoluteMs: 30 * 24 * 3_600_000, idleMs: 30 * 24 * 3_600_000 },
};
const ttlFor = (role: UserRole) => (role === 'CUSTOMER' ? TTL.customer : TTL.staff);
const TOUCH_AFTER_MS = 60_000;

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export type LoginOutcome =
  | { kind: 'session'; token: string; expiresAt: Date; auth: AuthContext }
  | { kind: 'mfa'; challengeToken: string };

export interface LoginContext {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export function toMe(auth: AuthContext): MeDto {
  return {
    id: auth.userId,
    email: auth.email,
    fullName: auth.fullName,
    role: auth.role,
    permissions: [...ROLE_PERMISSIONS[auth.role]],
    csrfToken: auth.csrfToken,
    mfaEnabled: auth.mfaEnabled,
    mfaRestricted: auth.mfaRestricted,
  };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(PasswordHasher) private readonly hasher: PasswordHasher,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(MfaService) private readonly mfa: MfaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async login(email: string, password: string, ctx: LoginContext): Promise<LoginOutcome> {
    const throttleKey = `${ctx.ip ?? 'unknown'}|${email}`;
    if (this.throttle.isBlocked(throttleKey)) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn đã thử đăng nhập quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    }

    // a mobile number (+84...) signs in a phone account; anything else is an email
    const byPhone = email.startsWith('+84');
    const { rows } = await this.db.query<{
      id: string;
      email: string | null;
      password_hash: string;
      full_name: string;
      role: UserRole;
      status: string;
    }>(
      `SELECT id, email, password_hash, full_name, role, status FROM users WHERE ${
        byPhone ? 'phone = $1 AND phone_verified_at IS NOT NULL' : 'email = $1'
      }`,
      [email],
    );
    const user = rows[0];
    const valid = user
      ? await this.hasher.verify(user.password_hash, password)
      : (await this.hasher.verifyDummy(password), false);

    if (!user || !valid || user.status !== 'ACTIVE') {
      this.throttle.recordFailure(throttleKey);
      await this.audit.record({
        actorId: user?.id ?? null,
        action: 'auth.login_failed',
        metadata: { email, ip: ctx.ip },
        requestId: ctx.requestId,
      });
      throw new AppError(
        'INVALID_CREDENTIALS',
        401,
        'Email/số điện thoại hoặc mật khẩu không đúng.',
      );
    }
    this.throttle.reset(throttleKey);

    const staff = user.role !== 'CUSTOMER';
    // Staff with a second factor must present it before any session exists.
    if (staff && (await this.mfa.isEnabled(user.id))) {
      return { kind: 'mfa', challengeToken: this.mfa.box.signChallenge(user.id) };
    }
    const restricted = staff && this.env.REQUIRE_STAFF_MFA;
    return this.db.transaction(async (client) => ({
      kind: 'session' as const,
      ...(await this.startSession(
        client,
        { id: user.id, email: user.email, fullName: user.full_name, role: user.role },
        ctx,
        'auth.login',
        restricted,
      )),
    }));
  }

  /**
   * Sign-in with a Google account. Known Google identity: just sign in. Unknown Google identity: a new
   * customer is created (email already confirmed by Google, no usable password). If the email belongs to
   * ANY existing account the sign-in is refused: Google never links itself to a password account, because
   * that would let whoever controls the Google address take over an account whose email was never confirmed.
   */
  async loginWithGoogle(
    profile: { sub: string; email: string; name: string },
    ctx: LoginContext,
  ): Promise<{ token: string; expiresAt: Date; auth: AuthContext; created: boolean }> {
    const email = profile.email.trim().toLowerCase();
    const refused = () =>
      new AppError(
        'CONFLICT',
        409,
        'Email này đã được đăng ký bằng mật khẩu. Hãy đăng nhập bằng email và mật khẩu.',
        { reason: 'EMAIL_EXISTS' },
      );
    try {
      return await this.db.transaction(async (client) => {
        const known = await client.query<{
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          status: string;
        }>(
          `SELECT u.id, u.email, u.full_name, u.role, u.status FROM user_identities i
           JOIN users u ON u.id = i.user_id WHERE i.provider = 'google' AND i.subject = $1`,
          [profile.sub],
        );
        const user = known.rows[0];
        if (user) {
          if (user.status !== 'ACTIVE' || user.role !== 'CUSTOMER')
            throw new AppError('INVALID_CREDENTIALS', 401, 'Tài khoản không thể đăng nhập.');
          const session = await this.startSession(
            client,
            { id: user.id, email: user.email, fullName: user.full_name, role: 'CUSTOMER' },
            ctx,
            'auth.google_login',
          );
          return { ...session, created: false };
        }
        const taken = await client.query('SELECT 1 FROM users WHERE email = $1', [email]);
        if (taken.rowCount) throw refused();
        const fullName = profile.name.trim().slice(0, 100) || email.split('@')[0]!;
        const unusable = await this.hasher.hash(randomBytes(32).toString('hex'));
        const created = await client.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, full_name, role, email_verified_at)
           VALUES ($1,$2,$3,'CUSTOMER', now()) RETURNING id`,
          [email, unusable, fullName],
        );
        await client.query(
          `INSERT INTO user_identities (provider, subject, user_id, email) VALUES ('google', $1, $2, $3)`,
          [profile.sub, created.rows[0]!.id, email],
        );
        await enqueueOutbox(client, 'auth.welcome', { email, fullName });
        const session = await this.startSession(
          client,
          { id: created.rows[0]!.id, email, fullName, role: 'CUSTOMER' },
          ctx,
          'auth.google_register',
        );
        return { ...session, created: true };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw refused(); // lost a race with another sign-up
      throw error;
    }
  }

  private async startSession(
    client: pg.PoolClient,
    user: { id: string; email: string | null; fullName: string; role: UserRole },
    ctx: LoginContext,
    action: string,
    restricted = false,
  ) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlFor(user.role).absoluteMs);
    const res = await client.query<{ id: string }>(
      `INSERT INTO sessions (user_id, token_hash, csrf_token, user_agent, ip_address, expires_at, mfa_restricted)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        user.id,
        sha256(token),
        csrfToken,
        ctx.userAgent?.slice(0, 300) ?? null,
        ctx.ip ?? null,
        expiresAt,
        restricted,
      ],
    );
    await client.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    await this.audit.record(
      { actorId: user.id, action, metadata: { ip: ctx.ip }, requestId: ctx.requestId },
      client,
    );
    const auth: AuthContext = {
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      sessionId: res.rows[0]!.id,
      csrfToken,
      mfaEnabled: false,
      mfaRestricted: restricted,
    };
    return { token, expiresAt, auth };
  }

  /**
   * Creates a CUSTOMER whose email or phone has just been proven with a one-time code, and signs them in.
   * Called by the registration challenge inside its transaction.
   */
  async createVerifiedCustomer(
    client: pg.PoolClient,
    input: {
      channel: 'EMAIL' | 'PHONE';
      identifier: string;
      fullName: string;
      passwordHash: string;
    },
    ctx: LoginContext,
  ) {
    const email = input.channel === 'EMAIL' ? input.identifier : null;
    const phone = input.channel === 'PHONE' ? input.identifier : null;
    const res = await client.query<{ id: string }>(
      `INSERT INTO users (email, phone, password_hash, full_name, role, email_verified_at, phone_verified_at)
       VALUES ($1,$2,$3,$4,'CUSTOMER', CASE WHEN $1::text IS NULL THEN NULL ELSE now() END,
               CASE WHEN $2::text IS NULL THEN NULL ELSE now() END) RETURNING id`,
      [email, phone, input.passwordHash, input.fullName],
    );
    if (email) await enqueueOutbox(client, 'auth.welcome', { email, fullName: input.fullName });
    return this.startSession(
      client,
      { id: res.rows[0]!.id, email, fullName: input.fullName, role: 'CUSTOMER' },
      ctx,
      'auth.register',
    );
  }

  /** Sets a new password after a proven reset (by email link or by phone code), signs out everywhere and notifies. */
  async applyPasswordReset(
    client: pg.PoolClient,
    user: { id: string; email: string | null; fullName: string },
    passwordHash: string,
    ctx: LoginContext,
  ) {
    await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
      passwordHash,
      user.id,
    ]);
    await client.query(
      'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
      [user.id],
    );
    if (user.email)
      await enqueueOutbox(client, 'auth.password_changed', {
        email: user.email,
        fullName: user.fullName,
        how: 'reset',
      });
    await this.audit.record(
      {
        actorId: user.id,
        action: 'auth.password_reset',
        metadata: { ip: ctx.ip },
        requestId: ctx.requestId,
      },
      client,
    );
  }

  /** Rotates the session token and CSRF token and extends expiry; the old cookie stops working. */
  async refresh(auth: AuthContext) {
    const token = randomBytes(32).toString('base64url');
    const csrfToken = randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlFor(auth.role).absoluteMs);
    await this.db.query(
      'UPDATE sessions SET token_hash = $1, csrf_token = $2, expires_at = $3, last_seen_at = now() WHERE id = $4',
      [sha256(token), csrfToken, expiresAt, auth.sessionId],
    );
    return { token, expiresAt, auth: { ...auth, csrfToken } };
  }

  async updateProfile(
    auth: AuthContext,
    fullName: string,
    requestId?: string,
  ): Promise<AuthContext> {
    await this.db.transaction(async (client) => {
      await client.query('UPDATE users SET full_name = $1, updated_at = now() WHERE id = $2', [
        fullName,
        auth.userId,
      ]);
      await this.audit.record(
        { actorId: auth.userId, action: 'account.update_profile', requestId },
        client,
      );
    });
    return { ...auth, fullName };
  }

  /** Verifies the current password, sets the new one and signs out every other session. */
  async changePassword(
    auth: AuthContext,
    currentPassword: string,
    newPassword: string,
    requestId?: string,
  ): Promise<void> {
    const { rows } = await this.db.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE id = $1',
      [auth.userId],
    );
    if (!rows[0] || !(await this.hasher.verify(rows[0].password_hash, currentPassword))) {
      throw new AppError('INVALID_CREDENTIALS', 401, 'Mật khẩu hiện tại không đúng.');
    }
    if (auth.email && newPassword.toLowerCase() === auth.email)
      throw AppError.validation({
        issues: [{ path: 'newPassword', message: 'Mật khẩu không được trùng email' }],
      });
    const hash = await this.hasher.hash(newPassword);
    await this.db.transaction(async (client) => {
      await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
        hash,
        auth.userId,
      ]);
      await client.query(
        'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL',
        [auth.userId, auth.sessionId],
      );
      if (auth.email)
        await enqueueOutbox(client, 'auth.password_changed', {
          email: auth.email,
          fullName: auth.fullName,
          how: 'change',
        });
      await this.audit.record(
        { actorId: auth.userId, action: 'auth.password_change', requestId },
        client,
      );
    });
  }

  /**
   * Starts a password reset. Always behaves the same for known and unknown emails (no account
   * enumeration); the link is delivered by the outbox/worker, and only a hash of the token is stored.
   */
  async requestPasswordReset(email: string, ctx: LoginContext): Promise<void> {
    const ipKey = `reset-ip|${ctx.ip ?? 'unknown'}`;
    const mailKey = `reset-mail|${email}`;
    if (this.throttle.isBlocked(ipKey, 10) || this.throttle.isBlocked(mailKey, 3)) {
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn đã yêu cầu quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    }
    this.throttle.recordFailure(ipKey);
    this.throttle.recordFailure(mailKey);

    const { rows } = await this.db.query<{ id: string; full_name: string }>(
      `SELECT id, full_name FROM users WHERE email = $1 AND status = 'ACTIVE'`,
      [email],
    );
    const user = rows[0];
    if (!user) {
      await this.hasher.verifyDummy('timing'); // keep response time similar
      return;
    }
    const token = randomBytes(32).toString('base64url');
    await this.db.transaction(async (client) => {
      await client.query(
        'UPDATE password_reset_tokens SET used_at = now() WHERE user_id = $1 AND used_at IS NULL',
        [user.id],
      );
      await client.query(
        `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2, now() + interval '1 hour')`,
        [user.id, sha256(token)],
      );
      await enqueueOutbox(client, 'auth.password_reset', {
        email,
        fullName: user.full_name,
        resetPath: `/dat-lai-mat-khau?token=${token}`,
      });
      await this.audit.record(
        {
          actorId: user.id,
          action: 'auth.password_reset_requested',
          metadata: { ip: ctx.ip },
          requestId: ctx.requestId,
        },
        client,
      );
    });
  }

  /** Consumes a reset token once, sets the new password and signs the user out everywhere. */
  async resetPassword(token: string, newPassword: string, ctx: LoginContext): Promise<void> {
    const hash = await this.hasher.hash(newPassword);
    await this.db.transaction(async (client) => {
      const found = await client.query<{
        id: string;
        user_id: string;
        email: string;
        full_name: string;
      }>(
        `SELECT t.id, t.user_id, u.email, u.full_name FROM password_reset_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.status = 'ACTIVE' FOR UPDATE OF t`,
        [sha256(token)],
      );
      const row = found.rows[0];
      if (!row)
        throw new AppError(
          'TOKEN_INVALID',
          400,
          'Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.',
        );
      if (newPassword.toLowerCase() === row.email)
        throw AppError.validation({
          issues: [{ path: 'newPassword', message: 'Mật khẩu không được trùng email' }],
        });
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [
        row.id,
      ]);
      await client.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [
        hash,
        row.user_id,
      ]);
      await client.query(
        'UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
        [row.user_id],
      );
      await enqueueOutbox(client, 'auth.password_changed', {
        email: row.email,
        fullName: row.full_name,
        how: 'reset',
      });
      await this.audit.record(
        {
          actorId: row.user_id,
          action: 'auth.password_reset',
          metadata: { ip: ctx.ip },
          requestId: ctx.requestId,
        },
        client,
      );
    });
  }

  /** Resolves a cookie token to an auth context, enforcing expiry, idle timeout, revocation and account status. */
  async authenticate(token: string): Promise<AuthContext | null> {
    const { rows } = await this.db.query<{
      session_id: string;
      csrf_token: string;
      last_seen_at: Date;
      user_id: string;
      email: string;
      full_name: string;
      role: UserRole;
      mfa_restricted: boolean;
      mfa_enabled: boolean;
    }>(
      `SELECT s.id AS session_id, s.csrf_token, s.last_seen_at, s.mfa_restricted, u.id AS user_id, u.email, u.full_name, u.role,
              EXISTS (SELECT 1 FROM user_mfa m WHERE m.user_id = u.id AND m.enabled_at IS NOT NULL) AS mfa_enabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.status = 'ACTIVE'`,
      [sha256(token)],
    );
    const row = rows[0];
    if (!row) return null;
    const idleFor = Date.now() - row.last_seen_at.getTime();
    if (idleFor > ttlFor(row.role).idleMs) return null;
    if (idleFor > TOUCH_AFTER_MS)
      await this.db.query('UPDATE sessions SET last_seen_at = now() WHERE id = $1', [
        row.session_id,
      ]);
    return {
      userId: row.user_id,
      email: row.email,
      fullName: row.full_name,
      role: row.role,
      sessionId: row.session_id,
      csrfToken: row.csrf_token,
      mfaEnabled: row.mfa_enabled,
      mfaRestricted: row.mfa_restricted,
    };
  }

  /** Second login step: a valid challenge (password already verified) plus a TOTP or recovery code. */
  async completeMfaLogin(challengeToken: string, code: string, ctx: LoginContext) {
    const userId = this.mfa.box.verifyChallenge(challengeToken);
    if (!userId)
      throw new AppError('MFA_INVALID', 401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.');
    const key = `mfa|${userId}`;
    if (this.throttle.isBlocked(key, 5))
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn đã nhập sai mã quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    const method = await this.mfa.verifyLogin(userId, code);
    if (!method) {
      this.throttle.recordFailure(key);
      await this.audit.record({
        actorId: userId,
        action: 'auth.mfa_failed',
        metadata: { ip: ctx.ip },
        requestId: ctx.requestId,
      });
      throw new AppError('MFA_INVALID', 401, 'Mã xác thực không đúng.');
    }
    this.throttle.reset(key);
    const { rows } = await this.db.query<{ email: string; full_name: string; role: UserRole }>(
      `SELECT email, full_name, role FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [userId],
    );
    const user = rows[0];
    if (!user) throw new AppError('INVALID_CREDENTIALS', 401, 'Tài khoản không khả dụng.');
    return this.db.transaction(async (client) => {
      const started = await this.startSession(
        client,
        { id: userId, email: user.email, fullName: user.full_name, role: user.role },
        ctx,
        `auth.login_mfa_${method}`,
      );
      return { ...started, auth: { ...started.auth, mfaEnabled: true } };
    });
  }

  async logout(auth: AuthContext, requestId?: string): Promise<void> {
    await this.db.transaction(async (client) => {
      await client.query('UPDATE sessions SET revoked_at = now() WHERE id = $1', [auth.sessionId]);
      await this.audit.record({ actorId: auth.userId, action: 'auth.logout', requestId }, client);
    });
  }
}
