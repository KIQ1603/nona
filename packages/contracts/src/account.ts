import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(254);

export const PASSWORD_MIN_LENGTH = 10;
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Mật khẩu cần ít nhất ${PASSWORD_MIN_LENGTH} ký tự`)
  .max(200);

/** Vietnamese mobile numbers only (03x, 05x, 07x, 08x, 09x): the only ones that can receive a code. Returns +84... or null. */
export const normalizeVnMobile = (v: string): string | null => {
  const t = v.replace(/[\s.-]/g, '');
  const m = /^(?:\+84|84|0)([35789][0-9]{8})$/.exec(t);
  return m ? `+84${m[1]}` : null;
};
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export type Identifier =
  | { kind: 'EMAIL'; value: string }
  | { kind: 'PHONE'; value: string }
  | { kind: 'INVALID'; reason: string };
/** Tells an email from a phone number, so a single field can serve both ("Email hoặc số điện thoại"). */
export function classifyIdentifier(input: string): Identifier {
  const v = input.trim();
  if (!v) return { kind: 'INVALID', reason: 'Vui lòng nhập email hoặc số điện thoại' };
  if (v.includes('@')) {
    const e = v.toLowerCase();
    return EMAIL_RE.test(e) && e.length <= 254
      ? { kind: 'EMAIL', value: e }
      : { kind: 'INVALID', reason: 'Email không hợp lệ' };
  }
  if (/^[+\d\s.-]+$/.test(v)) {
    const p = normalizeVnMobile(v);
    return p
      ? { kind: 'PHONE', value: p }
      : {
          kind: 'INVALID',
          reason: 'Số điện thoại không hợp lệ: cần số di động Việt Nam (đầu số 03, 05, 07, 08, 09)',
        };
  }
  return { kind: 'INVALID', reason: 'Hãy nhập email hợp lệ hoặc số điện thoại di động' };
}
const identifierField = z
  .string()
  .trim()
  .max(254)
  .superRefine((v, ctx) => {
    const c = classifyIdentifier(v);
    if (c.kind === 'INVALID') ctx.addIssue({ code: 'custom', message: c.reason });
  });

/** Step 1 of sign-up: nothing is created yet, a code is sent to the email or phone. */
export const registerStartSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Vui lòng nhập họ tên').max(100),
    identifier: identifierField,
    password: passwordSchema,
    confirmPassword: z.string().max(200),
  })
  .refine((v) => v.password === v.confirmPassword, {
    message: 'Mật khẩu nhập lại không khớp',
    path: ['confirmPassword'],
  })
  .refine((v) => v.password.toLowerCase() !== v.identifier.toLowerCase(), {
    message: 'Mật khẩu không được trùng email hoặc số điện thoại',
    path: ['password'],
  });
/** Step 2: the code proves the person owns the email / phone; only now the account is created. */
export const registerVerifySchema = z.object({
  token: z.string().uuid(),
  code: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, 'Mã gồm 6 chữ số'),
});
export const registerResendSchema = z.object({ token: z.string().uuid() });
export const challengeSentSchema = z.object({
  token: z.string().uuid(),
  channel: z.enum(['EMAIL', 'PHONE']),
  /** Where the code went, partly hidden: "a***@gmail.com" or "+84 *** *** 678". */
  destination: z.string(),
  expiresInSeconds: z.number().int(),
  resendAfterSeconds: z.number().int(),
  devCode: z.string().optional(),
  /** 'firebase' = no code was sent by us: the browser asks Firebase to text the number and sends back its ID token. */
  provider: z.literal('firebase').optional(),
});
export type ChallengeSent = z.infer<typeof challengeSentSchema>;

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
      const n = normalizeVnMobile(v);
      if (!n)
        ctx.addIssue({
          code: 'custom',
          message:
            'Số điện thoại không hợp lệ: cần số di động Việt Nam (đầu số 03, 05, 07, 08, 09)',
        });
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

/** Firebase Phone Auth: the browser got an ID token after the person typed the SMS code Firebase sent. */
export const firebaseIdTokenSchema = z.object({ idToken: z.string().min(100).max(4096) });
export const registerVerifyFirebaseSchema = firebaseIdTokenSchema.extend({
  token: z.string().uuid(),
});
export const firebaseWebConfigSchema = z.object({
  apiKey: z.string(),
  authDomain: z.string(),
  projectId: z.string(),
  appId: z.string(),
});
export type FirebaseWebConfig = z.infer<typeof firebaseWebConfigSchema>;
/** What `GET /auth/providers` says: Google sign-in on/off and, if on, how phone numbers are verified. */
export const authProvidersSchema = z.object({
  google: z.boolean(),
  phone: z.object({
    provider: z.enum(['sms', 'firebase']),
    firebase: firebaseWebConfigSchema.nullable(),
  }),
});
export type AuthProviders = z.infer<typeof authProvidersSchema>;
