import { describe, expect, it } from 'vitest';
import { classifyIdentifier, normalizeVnMobile, registerStartSchema } from './account';
import { loginSchema } from './auth';

describe('email or phone', () => {
  it('normalises Vietnamese mobile numbers in every common format', () => {
    for (const v of [
      '0912345678',
      '+84912345678',
      '84912345678',
      '091 234 5678',
      '0912.345.678',
      '0912-345-678',
    ])
      expect(normalizeVnMobile(v), v).toBe('+84912345678');
    expect(normalizeVnMobile('0328888888')).toBe('+84328888888');
  });
  it('refuses landlines, wrong prefixes, wrong lengths and foreign numbers', () => {
    for (const v of [
      '0212345678',
      '0112345678',
      '0412345678',
      '091234567',
      '09123456789',
      '+14155550100',
      'abc',
      '',
    ])
      expect(normalizeVnMobile(v), v).toBeNull();
  });
  it('tells an email from a phone number and explains what is wrong otherwise', () => {
    expect(classifyIdentifier(' Khach@Example.COM ')).toEqual({
      kind: 'EMAIL',
      value: 'khach@example.com',
    });
    expect(classifyIdentifier('0912 345 678')).toEqual({ kind: 'PHONE', value: '+84912345678' });
    const bad = classifyIdentifier('0212345678');
    expect(bad.kind).toBe('INVALID');
    expect(bad.kind === 'INVALID' && bad.reason).toMatch(/đầu số/);
    expect(classifyIdentifier('a@b').kind).toBe('INVALID');
    expect(classifyIdentifier('hello world').kind).toBe('INVALID');
    expect(classifyIdentifier('').kind).toBe('INVALID');
  });
  it('the sign-up schema needs a valid identifier and matching passwords', () => {
    const ok = {
      fullName: 'A',
      identifier: '0912345678',
      password: 'long-enough-pw',
      confirmPassword: 'long-enough-pw',
    };
    expect(registerStartSchema.safeParse(ok).success).toBe(true);
    expect(registerStartSchema.safeParse({ ...ok, identifier: '0212345678' }).success).toBe(false);
    expect(
      registerStartSchema.safeParse({ ...ok, confirmPassword: 'other-long-pw1' }).success,
    ).toBe(false);
  });
  it('login accepts an email, a bare username and any phone format', () => {
    expect(loginSchema.parse({ email: '0912 345 678', password: 'x' }).email).toBe('+84912345678');
    expect(loginSchema.parse({ email: 'Admin', password: 'x' }).email).toBe('admin@local');
    expect(loginSchema.parse({ email: 'a@b.vn', password: 'x' }).email).toBe('a@b.vn');
  });
});
