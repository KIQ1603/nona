import { z } from 'zod';
import { customOptionsBaseSchema, customOptionsSchema } from './design';

export const announcementSettingSchema = z.object({
  enabled: z.boolean(),
  text: z.string().trim().max(160),
  /** Same-site path or https URL only (blocks javascript:/data: links). */
  linkUrl: z
    .string()
    .trim()
    .max(300)
    .refine(
      (v) => (v.startsWith('/') && !v.startsWith('//')) || v.startsWith('https://'),
      'Chỉ cho phép đường dẫn nội bộ hoặc https://',
    )
    .nullable(),
});
export const shippingZoneSchema = z.object({
  name: z.string().trim().min(1).max(60),
  /** Destination provinces/cities this zone covers (matched ignoring case and diacritics). */
  provinces: z.array(z.string().trim().min(1).max(100)).min(1).max(70),
  flatFeeVnd: z.number().int().min(0).max(10_000_000),
  freeShippingThresholdVnd: z.number().int().min(0).max(1_000_000_000).nullable(),
});
export type ShippingZone = z.infer<typeof shippingZoneSchema>;

export const checkoutSettingSchema = z.object({
  /** How long stock is held while the customer pays online. */
  paymentWindowMinutes: z.number().int().min(5).max(1440),
  /** The phone number that receives an order must be confirmed with an OTP before the order can be placed. */
  requirePhoneVerification: z.boolean().default(true),
});

export const shippingSettingSchema = z.object({
  /** Orders at/above this subtotal ship free. null disables the offer. Enforced by the backend from Phase 4. */
  freeShippingThresholdVnd: z.number().int().min(0).max(1_000_000_000).nullable(),
  /** Flat shipping fee charged below the threshold. 0 = always free. */
  flatFeeVnd: z.number().int().min(0).max(10_000_000),
  /** Optional per-destination rates. The first zone containing the province wins; otherwise the defaults above apply. */
  zones: z.array(shippingZoneSchema).max(20).default([]),
});

export const CONTACT_KINDS = [
  'ZALO',
  'FACEBOOK',
  'MESSENGER',
  'TIKTOK',
  'INSTAGRAM',
  'YOUTUBE',
  'EMAIL',
  'PHONE',
  'OTHER',
] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const CONTACT_KIND_LABELS: Record<ContactKind, string> = {
  ZALO: 'Zalo',
  FACEBOOK: 'Facebook',
  MESSENGER: 'Messenger',
  TIKTOK: 'TikTok',
  INSTAGRAM: 'Instagram',
  YOUTUBE: 'YouTube',
  EMAIL: 'Email (Gmail)',
  PHONE: 'Điện thoại',
  OTHER: 'Khác',
};

/** Only https links, mailto: and tel: may be opened from the storefront (blocks javascript:/data: links). */
export const safeContactUrl = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .refine(
    (v) =>
      /^(https:\/\/[^\s<>"']+|mailto:[^\s<>"',;]+@[^\s<>"',;]+|tel:[+0-9][0-9\s.-]{5,20})$/i.test(
        v,
      ),
    'Chỉ cho phép https://, mailto: hoặc tel:',
  );

export const contactChannelSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,30}$/, 'Mã gồm chữ thường, số, - hoặc _'),
  kind: z.enum(CONTACT_KINDS),
  label: z.string().trim().min(1).max(40),
  url: safeContactUrl,
  enabled: z.boolean(),
});
export type ContactChannel = z.infer<typeof contactChannelSchema>;

/** Contact channels and the contact page content, all admin-managed. */
export const contactBaseSchema = z.object({
  /** Show the floating, pulsing chat buttons on every storefront page. */
  floatingEnabled: z.boolean(),
  headline: z.string().trim().max(120),
  description: z.string().trim().max(500),
  address: z.string().trim().max(200),
  hours: z.string().trim().max(160),
  channels: z.array(contactChannelSchema).max(10),
});
export const contactSettingSchema = contactBaseSchema.strict().superRefine((v, ctx) => {
  const ids = v.channels.map((c) => c.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', path: ['channels'], message: 'Mã kênh bị trùng' });
});
export type ContactSettings = z.infer<typeof contactSettingSchema>;

const text = (max: number) => z.string().trim().max(max);
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((v) => /^https:\/\/[^\s<>"']+$/i.test(v), 'Chỉ cho phép liên kết https://');
const richTitle = z.object({ before: text(120), accent: text(80), after: text(120) }).strict();

/** Content of the brand landing page. Every claim, number and picture is admin-managed, never hard-coded. */
export const landingBaseSchema = z.object({
  hero: z
    .object({
      eyebrow: text(80),
      titleTop: text(40),
      titleAccent: text(40),
      text: text(400),
      primaryCta: text(40),
      secondaryCta: text(40),
    })
    .strict(),
  story: z
    .object({
      eyebrow: text(40),
      title: richTitle,
      text: text(700),
      bigWord: text(8),
      badgeText: text(60),
      imageUrl: httpsUrl.nullable(),
      imageAlt: text(120),
      stats: z
        .array(
          z
            .object({
              value: z.number().int().min(0).max(100_000_000),
              suffix: text(4),
              label: text(40),
            })
            .strict(),
        )
        .max(4),
    })
    .strict(),
  process: z
    .object({
      eyebrow: text(40),
      title: richTitle,
      steps: z
        .array(
          z
            .object({ icon: text(8), title: text(60), text: text(240), duration: text(30) })
            .strict(),
        )
        .max(8),
    })
    .strict(),
  testimonials: z
    .object({
      eyebrow: text(40),
      items: z
        .array(
          z
            .object({
              quote: text(300),
              name: text(60),
              where: text(80),
              imageUrl: httpsUrl.nullable(),
              caption: text(80),
            })
            .strict(),
        )
        .max(8),
    })
    .strict(),
  order: z
    .object({
      eyebrow: text(40),
      titleTop: text(60),
      titleAccent: text(60),
      titleBottom: text(60),
      text: text(400),
    })
    .strict(),
});
export const landingSettingSchema = landingBaseSchema.strict();
export type LandingContent = z.infer<typeof landingSettingSchema>;

export const SETTING_SCHEMAS = {
  announcement: announcementSettingSchema,
  shipping: shippingSettingSchema,
  checkout: checkoutSettingSchema,
  custom: customOptionsSchema,
  contact: contactSettingSchema,
  landing: landingSettingSchema,
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;

export const storefrontSettingsSchema = z.object({
  announcement: announcementSettingSchema,
  freeShippingThresholdVnd: z.number().int().nullable(),
  flatShippingFeeVnd: z.number().int().nonnegative(),
  contact: contactSettingSchema,
});
export type StorefrontSettings = z.infer<typeof storefrontSettingsSchema>;

export const adminSettingsSchema = z.object({
  announcement: announcementSettingSchema.extend({ version: z.number().int() }),
  shipping: shippingSettingSchema.extend({ version: z.number().int() }),
  checkout: checkoutSettingSchema.extend({ version: z.number().int() }),
  custom: customOptionsBaseSchema.extend({ version: z.number().int() }),
  contact: contactBaseSchema.extend({ version: z.number().int() }),
  landing: landingBaseSchema.extend({ version: z.number().int() }),
});
export type AdminSettings = z.infer<typeof adminSettingsSchema>;

export const updateSettingSchema = z.object({
  version: z.number().int().min(1),
  value: z.record(z.unknown()),
});
