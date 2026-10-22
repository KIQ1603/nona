import { z } from 'zod';

export const initiatePaymentSchema = z.object({ orderCode: z.string().min(12).max(20) });
export const paymentSessionSchema = z.object({
  paymentUrl: z.string().url(),
  expiresAt: z.string(),
});

export const refundRequestSchema = z.object({
  amountVnd: z.number().int().min(1).max(1_000_000_000),
  reason: z.string().trim().min(1).max(300),
});
export const refundSchema = z.object({
  id: z.string(),
  amountVnd: z.number().int(),
  status: z.enum(['PENDING', 'SUCCEEDED', 'FAILED']),
  reason: z.string(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type RefundDto = z.infer<typeof refundSchema>;

export const resolveRefundSchema = z.object({
  outcome: z.enum(['SUCCEEDED', 'FAILED']),
  note: z.string().trim().min(1).max(300),
});
