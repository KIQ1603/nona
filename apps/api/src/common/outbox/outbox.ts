import type pg from 'pg';

/**
 * Transactional outbox: the event is written in the same transaction as the business change, so it is
 * delivered if (and only if) the change commits. The worker sends it with retries and a dead-letter state.
 */
export async function enqueueOutbox(
  client: Pick<pg.PoolClient, 'query'>,
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.query('INSERT INTO outbox_events (type, payload) VALUES ($1, $2::jsonb)', [
    type,
    JSON.stringify(payload),
  ]);
}
