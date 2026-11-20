import { z } from 'zod';
import { ORDER_STATUSES } from './orders';

const count = z.number().int();

/** Beacon sent by the storefront on each navigation. Anonymous: nothing identifies a person. */
export const trackEventSchema = z.object({
  visitorId: z
    .string()
    .min(16)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/),
  path: z
    .string()
    .min(1)
    .max(300)
    .regex(/^\/(?!\/)[^\s?#]*$/),
  referrer: z.string().max(300).optional(),
});
export type TrackEventInput = z.infer<typeof trackEventSchema>;

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export const analyticsQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((n) => (ANALYTICS_RANGES as readonly number[]).includes(n))
    .default(30),
});

/** Admin traffic and engagement report. Traffic comes from `analytics_events`; engagement from existing tables. */
export const adminAnalyticsSchema = z.object({
  generatedAt: z.string(),
  days: count,
  /** First moment a page view was recorded (null = tracking has not collected anything yet). */
  trackingSince: z.string().nullable(),
  traffic: z.object({
    pageViews: count,
    visitors: count,
    productViews: count,
    visitorsToday: count,
  }),
  /** One point per day over `days` (zero-filled). */
  daily: z.array(
    z.object({
      date: z.string(),
      pageViews: count,
      visitors: count,
      productViews: count,
      newAccounts: count,
      cartAdds: count,
      wishlistAdds: count,
      designs: count,
      orders: count,
    }),
  ),
  topPages: z.array(z.object({ path: z.string(), views: count, visitors: count })),
  topProducts: z.array(z.object({ slug: z.string(), name: z.string().nullable(), views: count })),
  referrers: z.array(z.object({ host: z.string(), visits: count })),
  /** Actions taken inside the period, counted from the shop's own records (available since launch). */
  engagement: z.object({
    newAccounts: count,
    cartAdds: count,
    wishlistAdds: count,
    designsStarted: count,
    designsSubmitted: count,
    orders: count,
  }),
  statusMix: z.array(z.object({ status: z.enum(ORDER_STATUSES), count })),
});
export type AdminAnalytics = z.infer<typeof adminAnalyticsSchema>;

export const adminUserListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  role: z.enum(['CUSTOMER', 'STAFF']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const adminUserListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      fullName: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      role: z.string(),
      status: z.string(),
      /** Linked Google sign-in (every account also has a password or phone code). */
      google: z.boolean(),
      emailVerified: z.boolean(),
      phoneVerified: z.boolean(),
      createdAt: z.string(),
      lastLoginAt: z.string().nullable(),
      lastSeenAt: z.string().nullable(),
      orders: count,
      spentVnd: z.number().int(),
      wishlist: count,
      designs: count,
    }),
  ),
  summary: z.object({
    total: count,
    customers: count,
    staff: count,
    disabled: count,
    newThisMonth: count,
    activeLast30Days: count,
  }),
  meta: z.object({ page: count, pageSize: count, total: count, totalPages: count }),
});
export type AdminUserList = z.infer<typeof adminUserListSchema>;
