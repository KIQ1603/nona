import type pg from 'pg';

/** Retention rules for short-lived data (security-operations.md: define retention for sessions, carts, ...). */
export async function cleanup(pool: pg.Pool) {
  const run = async (sql: string) => (await pool.query(sql)).rowCount ?? 0;
  return {
    guestCarts: await run(
      `DELETE FROM carts WHERE guest_token_hash IS NOT NULL AND updated_at < now() - interval '30 days'`,
    ),
    resetTokens: await run(
      `DELETE FROM password_reset_tokens WHERE expires_at < now() - interval '7 days'`,
    ),
    sessions: await run(
      `DELETE FROM sessions WHERE expires_at < now() - interval '30 days' OR revoked_at < now() - interval '30 days'`,
    ),
    idempotencyKeys: await run(
      `DELETE FROM idempotency_keys WHERE created_at < now() - interval '7 days'`,
    ),
    phoneOtps: await run(`DELETE FROM phone_otps WHERE created_at < now() - interval '2 days'`),
    sentOutbox: await run(
      `DELETE FROM outbox_events WHERE status = 'SENT' AND processed_at < now() - interval '30 days'`,
    ),
  };
}
