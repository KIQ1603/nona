import type { Permission, UserRole } from '@nona/contracts';

export interface AuthContext {
  userId: string;
  /** null for an account created with a phone number. */
  email: string | null;
  fullName: string;
  role: UserRole;
  sessionId: string;
  csrfToken: string;
  mfaEnabled: boolean;
  /** Session may only enrol in MFA until it does (production policy for staff). */
  mfaRestricted: boolean;
}

export interface RequestWithAuth {
  id?: string;
  auth?: AuthContext;
}

export type { Permission };
