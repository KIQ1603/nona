import { z } from 'zod';

export const COUPON_TYPES = ['PERCENT', 'FIXED', 'FREE_SHIPPING'] as const;
export type CouponType = (typeof COUPON_TYPES)[number];
export const COUPON_TYPE_LABELS: Record<CouponType, string> = {
  PERCENT: 'Giảm theo %',
  FIXED: 'Giảm số tiền cố định',
  FREE_SHIPPING: 'Miễn phí vận chuyển',
};

/** Why a coupon was refused. Stable codes; the message is Vietnamese. */
export const COUPON_ISSUES = [
  'NOT_FOUND',
  'INACTIVE',
  'NOT_STARTED',
  'EXPIRED',
  'MIN_ORDER',
  'EXHAUSTED',
  'USER_LIMIT',
] as const;
export type CouponIssue = (typeof COUPON_ISSUES)[number];

const money = z.number().int().min(0).max(1_000_000_000);
const baseCoupon = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{3,32}$/, 'Mã gồm 3–32 ký tự: chữ, số, - hoặc _'),
  description: z.string().trim().max(200).nullable().optional(),
  type: z.enum(COUPON_TYPES),
  value: money.default(0),
  minOrderVnd: money.default(0),
  maxDiscountVnd: money.min(1).nullable().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  usageLimitTotal: z.number().int().min(1).max(1_000_000).nullable().optional(),
  usageLimitPerUser: z.number().int().min(1).max(1000).nullable().optional(),
  isActive: z.boolean().default(true),
});

const refineCoupon = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((v: z.infer<typeof baseCoupon>, ctx) => {
    if (v.type === 'PERCENT' && (v.value < 1 || v.value > 100))
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Phần trăm giảm từ 1 đến 100' });
    if (v.type === 'FIXED' && v.value < 1)
      ctx.addIssue({ code: 'custom', path: ['value'], message: 'Số tiền giảm phải lớn hơn 0' });
    if (v.type === 'FREE_SHIPPING' && v.value !== 0)
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Mã miễn phí vận chuyển không có giá trị giảm',
      });
    if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt))
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'Ngày kết thúc phải sau ngày bắt đầu',
      });
  });

export const createCouponSchema = refineCoupon(baseCoupon);
export const updateCouponSchema = z.object({
  version: z.number().int().min(1),
  coupon: refineCoupon(baseCoupon),
});

export const couponSchema = z.object({
  id: z.string(),
  code: z.string(),
  description: z.string().nullable(),
  type: z.enum(COUPON_TYPES),
  value: z.number().int(),
  minOrderVnd: z.number().int(),
  maxDiscountVnd: z.number().int().nullable(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  usageLimitTotal: z.number().int().nullable(),
  usageLimitPerUser: z.number().int().nullable(),
  isActive: z.boolean(),
  version: z.number().int(),
  usedCount: z.number().int(),
});
export type CouponDto = z.infer<typeof couponSchema>;
export const couponListSchema = z.object({ items: z.array(couponSchema) });

export const applyCouponSchema = z.object({ code: z.string().trim().toUpperCase().min(1).max(32) });
export const appliedCouponSchema = z.object({
  code: z.string(),
  type: z.enum(COUPON_TYPES),
  description: z.string().nullable(),
  /** Goods discount in VND (0 for free-shipping coupons). */
  discountVnd: z.number().int().nonnegative(),
  freeShipping: z.boolean(),
});
export type AppliedCoupon = z.infer<typeof appliedCouponSchema>;
