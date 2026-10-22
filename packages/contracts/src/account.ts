import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

export const PASSWORD_MIN_LENGTH = 10;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
  .max(200);

export const registerSchema = z
  .object({
    email,
    password: passwordSchema,
    fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(100),
  })
  .refine((v) => v.password.toLowerCase() !== v.email, {
    message: 'Mật khẩu không được trùng email',
    path: ['password'],
  });

export const updateProfileSchema = z.object({ fullName: z.string().trim().min(1).max(100) });
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: passwordSchema,
    /** The new password typed a second time: it has to match. */
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirmPassword'],
  });

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s.-]/g, ''))
  .pipe(z.string().regex(/^(\+84|0)[0-9]{9,10}$/, 'Số điện thoại không hợp lệ'));

export const addressInputSchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  phone,
  line1: z.string().trim().min(1).max(200),
  ward: z.string().trim().min(1).max(100),
  district: z.string().trim().min(1).max(100),
  province: z.string().trim().min(1).max(100),
  isDefault: z.boolean().default(false),
});
export const updateAddressSchema = addressInputSchema.partial();
export const MAX_ADDRESSES = 10;

export const addressSchema = z.object({
  id: z.string(),
  fullName: z.string(),
  phone: z.string(),
  line1: z.string(),
  ward: z.string(),
  district: z.string(),
  province: z.string(),
  isDefault: z.boolean(),
});
export type AddressDto = z.infer<typeof addressSchema>;
export const addressListSchema = z.object({ items: z.array(addressSchema) });

export const wishlistSchema = z.object({ slugs: z.array(z.string()) });
export const wishlistMergeSchema = z.object({ slugs: z.array(z.string().max(120)).max(100) });

/** E.164 (+84...) form of a Vietnamese phone number typed as 0912345678, 091 234 5678 or +84912345678. */
export const normalizeVnPhone = (v: string): string | null => {
  const t = v.replace(/[\s.-]/g, '');
  if (!/^(\+84|0)[0-9]{9,10}$/.test(t)) return null;
  return t.startsWith('0') ? `+84${t.slice(1)}` : t;
};
export const OTP_LENGTH = 6;
export const phoneOtpRequestSchema = z.object({
  phone: z
    .string()
    .trim()
    .max(20)
    .transform((v, ctx) => {
      const n = normalizeVnPhone(v);
      if (!n) ctx.addIssue({ code: 'custom', message: 'Số điện thoại không hợp lệ' });
      return n ?? '';
    }),
});
export const phoneOtpVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(new RegExp(`^[0-9]{${OTP_LENGTH}}$`), `Mã gồm ${OTP_LENGTH} chữ số`),
});
export const phoneStatusSchema = z.object({
  /** Masked, e.g. +84 *** *** 678. null = no phone on the account. */
  phone: z.string().nullable(),
  verified: z.boolean(),
});
export const phoneOtpSentSchema = z.object({
  phone: z.string(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
  /** Only when the SMS simulator is on (never in production): lets you test without a real Zalo message. */
  devCode: z.string().optional(),
});
export type PhoneStatus = z.infer<typeof phoneStatusSchema>;
export type PhoneOtpSent = z.infer<typeof phoneOtpSentSchema>;
