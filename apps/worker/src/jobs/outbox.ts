import { renderEmail, type Mailer } from '@nona/mail';
import type pg from 'pg';
import { logger } from '../logger.js';
import { SmsRejectedError, type SmsSender } from '../sms.js';

export const MAX_ATTEMPTS = 6;
const BATCH = 20;
const LEASE = '5 minutes';

interface OutboxRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

/** 30s, 1m, 2m, 4m, 8m, 16m ... capped at 1h. */
export const backoffSeconds = (attempt: number) => Math.min(30 * 2 ** (attempt - 1), 3600);

/**
 * Delivers pending outbox events (at-least-once). Events are claimed with a lease using
 * FOR UPDATE SKIP LOCKED, so several workers never send the same event concurrently, and a crashed
 * worker's events become due again when the lease runs out. Failures retry with exponential backoff
 * and end up DEAD (with an error log to alert on) after MAX_ATTEMPTS.
 */
export async function processOutbox(
  pool: pg.Pool,
  mailer: Mailer,
  options: { webOrigin: string; sms?: SmsSender },
) {
  const claimed = await pool.query<OutboxRow>(
    `UPDATE outbox_events SET next_attempt_at = now() + interval '${LEASE}'
     WHERE id IN (SELECT id FROM outbox_events WHERE status = 'PENDING' AND next_attempt_at <= now()
                  ORDER BY created_at LIMIT ${BATCH} FOR UPDATE SKIP LOCKED)
     RETURNING id, type, payload, attempts`,
  );
  const stats = { sent: 0, skipped: 0, retried: 0, dead: 0 };

  for (const event of claimed.rows) {
    try {
      if (event.type === 'phone.otp') {
        const { phone, code, expiresAt, ttlMinutes } = event.payload as {
          phone?: string;
          code?: string;
          expiresAt?: string;
          ttlMinutes?: number;
        };
        if (!phone || !code) throw new PermanentError('phone.otp event is incomplete');
        if (expiresAt && Date.parse(expiresAt) < Date.now()) {
          await finish(pool, event.id, 'code expired before it was sent');
          stats.skipped++;
          continue;
        }
        if (!options.sms) throw new PermanentError('no SMS sender configured');
        try {
          await options.sms.sendOtp(phone, code, ttlMinutes ?? 5, event.id);
        } catch (e) {
          if (e instanceof SmsRejectedError) throw new PermanentError(e.message);
          throw e;
        }
        await finish(pool, event.id, null);
        stats.sent++;
        continue;
      }
      const email = renderEmail(event.type, event.payload, { webOrigin: options.webOrigin });
      const to = typeof event.payload.email === 'string' ? event.payload.email : null;
      if (!email) {
        await finish(pool, event.id, 'no email for this event type');
        stats.skipped++;
        continue;
      }
      if (event.payload.email === null) {
        // an account created with a phone number has no email: nothing to send
        await finish(pool, event.id, 'no email address on this order');
        stats.skipped++;
        continue;
      }
      if (!to) throw new PermanentError('event has no recipient');
      await mailer.send({ to, ...email });
      await finish(pool, event.id, null);
      stats.sent++;
    } catch (error) {
      const attempts = event.attempts + 1;
      const message = (error as Error).message.slice(0, 500);
      if (error instanceof PermanentError || attempts >= MAX_ATTEMPTS) {
        await pool.query(
          `UPDATE outbox_events SET status = 'DEAD', attempts = $2, last_error = $3, processed_at = now(),
             payload = CASE WHEN type IN ('phone.otp', 'auth.email_otp', 'auth.welcome') THEN '{}'::jsonb ELSE payload END WHERE id = $1`,
          [event.id, attempts, message],
        );
        logger.error(
          { eventId: event.id, type: event.type, attempts, err: message },
          'outbox event dead-lettered',
        );
        stats.dead++;
      } else {
        await pool.query(
          `UPDATE outbox_events SET attempts = $2, last_error = $3, next_attempt_at = now() + ($4 || ' seconds')::interval WHERE id = $1`,
          [event.id, attempts, message, String(backoffSeconds(attempts))],
        );
        logger.warn(
          { eventId: event.id, type: event.type, attempts, err: message },
          'outbox delivery failed, will retry',
        );
        stats.retried++;
      }
    }
  }
  return stats;
}

class PermanentError extends Error {}

/** Marks SENT and scrubs personal data from the stored payload (only the order code is kept). */
async function finish(pool: pg.Pool, id: string, note: string | null) {
  await pool.query(
    `UPDATE outbox_events
     SET status = 'SENT', processed_at = now(), last_error = $2,
         payload = CASE WHEN payload ? 'orderCode' THEN jsonb_build_object('orderCode', payload->'orderCode') ELSE '{}'::jsonb END
     WHERE id = $1`,
    [id, note],
  );
}
