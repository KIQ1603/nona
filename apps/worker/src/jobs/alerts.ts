import type pg from 'pg';
import { logger } from '../logger.js';

export interface Alert {
  code: string;
  message: string;
}

/**
 * Operational alerts, emitted as ERROR logs carrying `alert: true` so a log-based alerting rule
 * (Loki/Datadog/CloudWatch) can page someone. See docs/runbooks.
 */
export async function checkAlerts(pool: pg.Pool): Promise<Alert[]> {
  const n = async (sql: string) => Number((await pool.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
  const alerts: Alert[] = [];
  const dead = await n(`SELECT COUNT(*) AS n FROM outbox_events WHERE status = 'DEAD'`);
  if (dead > 0)
    alerts.push({ code: 'OUTBOX_DEAD', message: `${dead} outbox event(s) are dead-lettered` });
  const stuck = await n(
    `SELECT COUNT(*) AS n FROM outbox_events WHERE status = 'PENDING' AND created_at < now() - interval '10 minutes'`,
  );
  if (stuck > 0)
    alerts.push({
      code: 'OUTBOX_STUCK',
      message: `${stuck} outbox event(s) pending for over 10 minutes`,
    });
  const refunds = await n(
    `SELECT COUNT(*) AS n FROM refunds WHERE status = 'PENDING' AND created_at < now() - interval '5 minutes'`,
  );
  if (refunds > 0)
    alerts.push({
      code: 'REFUND_NEEDS_MANUAL',
      message: `${refunds} refund(s) pending with an unknown outcome`,
    });
  const payments = await n(
    `SELECT COUNT(*) AS n FROM payments WHERE provider = 'VNPAY' AND status = 'PENDING' AND created_at < now() - interval '30 minutes'`,
  );
  if (payments > 0)
    alerts.push({
      code: 'PAYMENT_STALE',
      message: `${payments} online payment(s) pending for over 30 minutes`,
    });
  for (const a of alerts) logger.error({ alert: true, code: a.code }, a.message);
  return alerts;
}
