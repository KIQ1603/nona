import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box';
import { base32Decode, base32Encode, generateSecret, otpauthUrl, totpAt, verifyTotp } from './totp';

// RFC 6238 appendix B: SHA-1 seed "12345678901234567890", 8-digit codes at fixed times.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpAt(RFC_SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(totpAt(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(totpAt(RFC_SECRET, Math.floor(1234567890 / 30), 8)).toBe('89005924');
    expect(totpAt(RFC_SECRET, Math.floor(20000000000 / 30), 8)).toBe('65353130');
  });
  it('round-trips base32', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('accepts the current and adjacent steps only, and reports the step for replay protection', () => {
    const now = 1_700_000_000_000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step), now)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step + 2), now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), now)).toBeNull();
  });
  it('rejects malformed codes', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', '12 3456'])
      expect(verifyTotp(RFC_SECRET, bad)).toBeNull();
  });
  it('builds an otpauth URL', () => {
    expect(otpauthUrl('ABC', 'a@b.vn')).toBe(
      'otpauth://totp/NONA%3Aa%40b.vn?secret=ABC&issuer=NONA&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(Buffer.alloc(32, 3).toString('base64'));
  it('encrypts with a fresh nonce and detects tampering', () => {
    const a = box.encrypt('JBSWY3DPEHPK3PXP');
    expect(a).not.toBe(box.encrypt('JBSWY3DPEHPK3PXP'));
    expect(box.decrypt(a)).toBe('JBSWY3DPEHPK3PXP');
    const tampered = Buffer.from(a, 'base64');
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() => box.decrypt(tampered.toString('base64'))).toThrow();
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'))).toThrow();
  });
  it('signs challenges that expire and cannot be forged', () => {
    const t = box.signChallenge('user-1', 1000, 5000);
    expect(box.verifyChallenge(t, 5500)).toBe('user-1');
    expect(box.verifyChallenge(t, 6001)).toBeNull();
    const [body] = t.split('.');
    expect(box.verifyChallenge(`${body}.AAAA`, 5500)).toBeNull();
    expect(
      box.verifyChallenge(
        `${Buffer.from('user-2.9999999999999').toString('base64url')}.${t.split('.')[1]}`,
        5500,
      ),
    ).toBeNull();
    expect(
      new SecretBox(Buffer.alloc(32, 9).toString('base64')).verifyChallenge(t, 5500),
    ).toBeNull();
  });
});
