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

export interface BootstrapEnv {
  BOOTSTRAP_ADMIN_EMAIL?: string;
  BOOTSTRAP_ADMIN_PASSWORD?: string;
  BOOTSTRAP_ADMIN_NAME?: string;
  BOOTSTRAP_USER_EMAIL?: string;
  BOOTSTRAP_USER_PASSWORD?: string;
  BOOTSTRAP_USER_NAME?: string;
  /** 'true' lets the passwords be any length (demo only: a public admin with a short password can be guessed). */
  BOOTSTRAP_ALLOW_WEAK_PASSWORDS?: string;
}

/**
 * Makes sure one admin and one customer account exist after a deploy (a fresh database has none). Idempotent and safe to run
 * on every start: an account that already exists is NEVER touched (its password is not reset, so a password changed later
 * stays). Each account is created only when both its email and password variables are set. Both are created with a
 * verified email, so they can sign in straight away. Returns what it created.
 */
export async function bootstrapAccounts(
  client: Pick<pg.ClientBase, 'query'>,
  env: BootstrapEnv = process.env as BootstrapEnv,
): Promise<string[]> {
  const created: string[] = [];
  const weakOk = env.BOOTSTRAP_ALLOW_WEAK_PASSWORDS === 'true';
  const plan = [
    {
      role: 'ADMIN',
      email: env.BOOTSTRAP_ADMIN_EMAIL,
      password: env.BOOTSTRAP_ADMIN_PASSWORD,
      name: env.BOOTSTRAP_ADMIN_NAME || 'Quản trị Sắc Chằm',
      min: 12,
    },
    {
      role: 'CUSTOMER',
      email: env.BOOTSTRAP_USER_EMAIL,
      password: env.BOOTSTRAP_USER_PASSWORD,
      name: env.BOOTSTRAP_USER_NAME || 'Khách thử',
      min: 10,
    },
  ];
  for (const a of plan) {
    if (!a.email || !a.password) continue;
    if (!weakOk && a.password.length < a.min)
      throw new Error(`${a.role} bootstrap password must be at least ${a.min} characters`);
    const email = a.email.trim().toLowerCase();
    const res = await client.query(
      `INSERT INTO users (email, password_hash, full_name, role, email_verified_at)
       VALUES ($1,$2,$3,$4, now()) ON CONFLICT (email) DO NOTHING RETURNING id`,
      [email, await hash(a.password, OPTIONS), a.name, a.role],
    );
    if (res.rowCount) created.push(`${a.role} ${email}`);
  }
  return created;
}
