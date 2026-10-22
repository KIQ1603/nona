import { hash } from '@node-rs/argon2';
import type pg from 'pg';

// Must match the API's PasswordHasher parameters (Argon2id).
const OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;
export const ROLES = ['SUPPORT', 'CATALOG', 'FULFILLMENT', 'FINANCE', 'ADMIN'] as const;

export async function upsertStaff(
  client: pg.Client,
  email: string,
  password: string,
  fullName: string,
  role: string,
): Promise<void> {
  if (!ROLES.includes(role as (typeof ROLES)[number]))
    throw new Error(`role must be one of ${ROLES.join(', ')}`);
  if (password.length < 12) throw new Error('password must be at least 12 characters');
  const normalized = email.trim().toLowerCase();
  await client.query(
    `INSERT INTO users (email, password_hash, full_name, role) VALUES ($1,$2,$3,$4)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, status = 'ACTIVE', updated_at = now()`,
    [normalized, await hash(password, OPTIONS), fullName, role],
  );
}
