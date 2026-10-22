import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { SecretBox } from '../secret-box';
import { generateSecret, otpauthUrl, verifyTotp } from '../totp';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const RECOVERY_CODES = 10;

/** Recovery codes look like `ABCD-EFGH-JKLM` (unambiguous alphabet). Stored only as hashes. */
const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function newRecoveryCode(): string {
  const b = randomBytes(12);
  const chars = Array.from(b, (x) => RECOVERY_ALPHABET[x % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}`;
}
const normalizeRecovery = (c: string) => c.replace(/\s/g, '').toUpperCase();

@Injectable()
export class MfaService {
  readonly box: SecretBox;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.box = new SecretBox(env.MFA_ENCRYPTION_KEY);
  }

  async isEnabled(userId: string): Promise<boolean> {
    const { rows } = await this.db.query(
      'SELECT 1 FROM user_mfa WHERE user_id = $1 AND enabled_at IS NOT NULL',
      [userId],
    );
    return rows.length > 0;
  }

  /** Starts (or restarts) enrolment: a fresh secret, not active until a valid code proves the app works. */
  async beginEnrolment(userId: string, email: string) {
    if (await this.isEnabled(userId))
      throw new AppError('CONFLICT', 409, 'Tài khoản đã bật xác thực hai lớp.');
    const secret = generateSecret();
    await this.db.query(
      `INSERT INTO user_mfa (user_id, secret_enc, enabled_at, last_used_step, recovery_hashes) VALUES ($1,$2,NULL,0,'[]'::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET secret_enc = EXCLUDED.secret_enc, enabled_at = NULL, last_used_step = 0, recovery_hashes = '[]'::jsonb`,
      [userId, this.box.encrypt(secret)],
    );
    return { secret, otpauthUrl: otpauthUrl(secret, email) };
  }

  /** Activates MFA after the user proves possession, lifts the session restriction and issues recovery codes (shown once). */
  async confirmEnrolment(
    userId: string,
    code: string,
    sessionId: string,
    requestId?: string,
  ): Promise<string[]> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query('SELECT secret_enc, enabled_at FROM user_mfa WHERE user_id = $1 FOR UPDATE', [
          userId,
        ])
      ).rows[0];
      if (!row || row.enabled_at)
        throw new AppError(
          'CONFLICT',
          409,
          'Chưa bắt đầu thiết lập, hoặc đã bật xác thực hai lớp.',
        );
      const step = verifyTotp(this.box.decrypt(row.secret_enc), code);
      if (step === null) throw new AppError('MFA_INVALID', 400, 'Mã xác thực không đúng.');
      const codes = Array.from({ length: RECOVERY_CODES }, newRecoveryCode);
      await c.query(
        `UPDATE user_mfa SET enabled_at = now(), last_used_step = $2, recovery_hashes = $3::jsonb WHERE user_id = $1`,
        [userId, step, JSON.stringify(codes.map((x) => sha256(normalizeRecovery(x))))],
      );
      await c.query('UPDATE sessions SET mfa_restricted = false WHERE id = $1', [sessionId]);
      await this.audit.record({ actorId: userId, action: 'auth.mfa_enabled', requestId }, c);
      return codes;
    });
  }

  /**
   * Checks a login code. A TOTP code works once (its time-step is remembered); a recovery code works once
   * and is then deleted. Row-locked so two parallel attempts cannot both succeed with the same code.
   */
  async verifyLogin(userId: string, code: string): Promise<'totp' | 'recovery' | null> {
    return this.db.transaction(async (c) => {
      const row = (
        await c.query(
          'SELECT secret_enc, last_used_step, recovery_hashes FROM user_mfa WHERE user_id = $1 AND enabled_at IS NOT NULL FOR UPDATE',
          [userId],
        )
      ).rows[0];
      if (!row) return null;
      const step = verifyTotp(this.box.decrypt(row.secret_enc), code.replace(/\s/g, ''));
      if (step !== null && step > Number(row.last_used_step)) {
        await c.query('UPDATE user_mfa SET last_used_step = $2 WHERE user_id = $1', [userId, step]);
        return 'totp' as const;
      }
      const hash = sha256(normalizeRecovery(code));
      const hashes: string[] = row.recovery_hashes;
      if (step === null && hashes.includes(hash)) {
        await c.query('UPDATE user_mfa SET recovery_hashes = $2::jsonb WHERE user_id = $1', [
          userId,
          JSON.stringify(hashes.filter((h) => h !== hash)),
        ]);
        await this.audit.record(
          {
            actorId: userId,
            action: 'auth.mfa_recovery_used',
            metadata: { remaining: hashes.length - 1 },
          },
          c,
        );
        return 'recovery' as const;
      }
      return null;
    });
  }

  /** Turning MFA off needs a current code, and is refused when policy requires MFA for staff. */
  async disable(userId: string, code: string, requestId?: string): Promise<void> {
    if (this.env.REQUIRE_STAFF_MFA)
      throw new AppError(
        'FORBIDDEN',
        403,
        'Chính sách bảo mật yêu cầu bật xác thực hai lớp cho nhân viên.',
      );
    if (!(await this.verifyLogin(userId, code)))
      throw new AppError('MFA_INVALID', 400, 'Mã xác thực không đúng.');
    await this.db.transaction(async (c) => {
      await c.query('DELETE FROM user_mfa WHERE user_id = $1', [userId]);
      await this.audit.record({ actorId: userId, action: 'auth.mfa_disabled', requestId }, c);
    });
  }
}
