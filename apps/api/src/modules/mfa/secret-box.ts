import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** AES-256-GCM for secrets at rest (TOTP seeds). Output: base64(iv | tag | ciphertext). */
export class SecretBox {
  private readonly key: Buffer;
  constructor(keyBase64: string) {
    this.key = Buffer.from(keyBase64, 'base64');
    if (this.key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes');
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    decipher.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]).toString('utf8');
  }

  /** Short-lived, stateless proof that the password step succeeded for `userId`. */
  signChallenge(userId: string, ttlMs = 5 * 60_000, now = Date.now()): string {
    const body = Buffer.from(`${userId}.${now + ttlMs}`).toString('base64url');
    return `${body}.${this.mac(body)}`;
  }

  verifyChallenge(token: string, now = Date.now()): string | null {
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expected = this.mac(body);
    if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
      return null;
    const [userId, exp] = Buffer.from(body, 'base64url').toString().split('.');
    return userId && Number(exp) > now ? userId : null;
  }

  private mac(data: string): string {
    return createHmac(
      'sha256',
      createHash('sha256').update('mfa-challenge').update(this.key).digest(),
    )
      .update(data)
      .digest('base64url');
  }
}
