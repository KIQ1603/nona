import { z } from 'zod';

export const USER_ROLES = [
  'CUSTOMER',
  'SUPPORT',
  'CATALOG',
  'FULFILLMENT',
  'FINANCE',
  'ADMIN',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const PERMISSIONS = [
  'catalog:write',
  'inventory:write',
  'settings:write',
  'audit:read',
  'admin:access',
  'orders:read',
  'orders:write',
  'refunds:write',
  'coupons:write',
  'system:read',
  'designs:read',
  'designs:review',
  'articles:write',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** Role → permissions. Single definition shared by API enforcement and admin UI visibility. */
export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  CUSTOMER: [],
  SUPPORT: ['admin:access', 'orders:read', 'designs:read'],
  CATALOG: [
    'admin:access',
    'catalog:write',
    'inventory:write',
    'designs:read',
    'designs:review',
    'articles:write',
  ],
  FULFILLMENT: ['admin:access', 'inventory:write', 'orders:read', 'orders:write', 'designs:read'],
  FINANCE: ['admin:access', 'orders:read', 'refunds:write'],
  ADMIN: [
    'admin:access',
    'catalog:write',
    'inventory:write',
    'settings:write',
    'audit:read',
    'orders:read',
    'orders:write',
    'refunds:write',
    'coupons:write',
    'system:read',
    'designs:read',
    'designs:review',
    'articles:write',
  ],
};

export const loginSchema = z.object({
  /** An address, or a bare username such as `admin` (short for admin@local). Login only looks the value up, so it is not held to full email rules. */
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .transform((v) => (v.includes('@') ? v : `${v}@local`))
    .pipe(z.string().regex(/^[^\s@]+@[^\s@]+$/, 'Email không hợp lệ')),
  password: z.string().min(1).max(200),
});

export const meSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: z.enum(USER_ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
  csrfToken: z.string(),
  mfaEnabled: z.boolean().default(false),
  /** Staff must enrol in MFA before using the admin area (production policy). */
  mfaRestricted: z.boolean().default(false),
});
export type MeDto = z.infer<typeof meSchema>;

export const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(24) });
export const mfaVerifySchema = z.object({
  challengeToken: z.string().min(20).max(200),
  code: z.string().trim().min(6).max(24),
});
export const mfaSetupSchema = z.object({ secret: z.string(), otpauthUrl: z.string() });
export const mfaConfirmedSchema = z.object({ recoveryCodes: z.array(z.string()) });
export const loginResultSchema = z.union([
  meSchema,
  z.object({ mfaRequired: z.literal(true), challengeToken: z.string() }),
]);
