import { randomBytes } from 'node:crypto';

// Crockford base32 without I, L, O, U: unambiguous when read aloud or copied by hand.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const ORDER_CODE_LENGTH = 12;
export const ORDER_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;

/** 12 symbols x 5 bits = 60 bits of randomness: unguessable, and distinct from the internal UUID. */
export function generateOrderCode(): string {
  const bytes = randomBytes(ORDER_CODE_LENGTH);
  return Array.from(bytes, (b) => ALPHABET[b & 31]).join('');
}

export const formatOrderCode = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');
/** Accepts user input like "ab12-cd34-ef56" and returns the canonical form (or null). */
export function normalizeOrderCode(input: string): string | null {
  const cleaned = input
    .replace(/[\s-]/g, '')
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  return ORDER_CODE_PATTERN.test(cleaned) ? cleaned : null;
}
