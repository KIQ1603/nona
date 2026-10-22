import { z } from 'zod';

/** Stable machine-readable codes. Messages are Vietnamese and may change without breaking clients. */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'CONFLICT',
  'RATE_LIMITED',
  'INVALID_CREDENTIALS',
  'INVENTORY_INSUFFICIENT',
  'PRICE_CHANGED',
  'COUPON_INVALID',
  'DESIGN_INVALID',
  'DESIGN_NOT_APPROVED',
  'PAYMENT_UNAVAILABLE',
  'PHONE_NOT_VERIFIED',
  'MFA_REQUIRED',
  'MFA_INVALID',
  'CART_EMPTY',
  'INVALID_STATE_TRANSITION',
  'TOKEN_INVALID',
  'PUBLISH_REQUIREMENTS_NOT_MET',
  'IDEMPOTENCY_KEY_REQUIRED',
  'IDEMPOTENCY_KEY_REUSED',
  'MEDIA_INVALID',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.record(z.unknown()).default({}),
    requestId: z.string(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
