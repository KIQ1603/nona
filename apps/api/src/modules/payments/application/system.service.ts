import { Inject, Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../platform/database/database.service';

export interface SystemAlert {
  severity: 'critical' | 'warning';
  code: string;
  message: string;
}
export interface SystemStatus {
  outbox: { pending: number; dead: number; oldestPendingSeconds: number };
  payments: { pending: number; stalePending: number };
  refunds: { pending: number; needsManual: number; failed: number };
  orders: Record<string, number>;
  reservations: { active: number };
  alerts: SystemAlert[];
  generatedAt: string;
}

/** Operational health derived from the database: the numbers an on-call person (or Prometheus) needs. */
@Injectable()
export class SystemService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async status(): Promise<SystemStatus> {
    const one = async (sql: string) =>
      Number((await this.db.query<{ n: string }>(sql)).rows[0]?.n ?? 0);
    const [
      pending,
      dead,
      oldest,
      payPending,
      payStale,
      refPending,
      refManual,
      refFailed,
      active,
      byStatus,
    ] = await Promise.all([
      one(`SELECT COUNT(*) AS n FROM outbox_events WHERE status = 'PENDING'`),
      one(`SELECT COUNT(*) AS n FROM outbox_events WHERE status = 'DEAD'`),
      one(
        `SELECT COALESCE(EXTRACT(EPOCH FROM now() - MIN(created_at)), 0)::bigint AS n FROM outbox_events WHERE status = 'PENDING'`,
      ),
      one(`SELECT COUNT(*) AS n FROM payments WHERE provider = 'VNPAY' AND status = 'PENDING'`),
      one(
        `SELECT COUNT(*) AS n FROM payments WHERE provider = 'VNPAY' AND status = 'PENDING' AND created_at < now() - interval '30 minutes'`,
      ),
      one(`SELECT COUNT(*) AS n FROM refunds WHERE status = 'PENDING'`),
      one(
        `SELECT COUNT(*) AS n FROM refunds WHERE status = 'PENDING' AND created_at < now() - interval '5 minutes'`,
      ),
      one(
        `SELECT COUNT(*) AS n FROM refunds WHERE status = 'FAILED' AND created_at > now() - interval '30 days'`,
      ),
      one(
        `SELECT COUNT(*) AS n FROM inventory_reservations WHERE status = 'ACTIVE' AND expires_at > now()`,
      ),
      this.db.query<{ status: string; n: string }>(
        `SELECT status, COUNT(*) AS n FROM orders GROUP BY status`,
      ),
    ]);
    const alerts: SystemAlert[] = [];
    if (dead > 0)
      alerts.push({
        severity: 'critical',
        code: 'OUTBOX_DEAD',
        message: `${dead} email/sự kiện gửi thất bại hoàn toàn (dead-letter) — cần kiểm tra SMTP và gửi lại thủ công.`,
      });
    if (oldest > 600)
      alerts.push({
        severity: 'warning',
        code: 'OUTBOX_STUCK',
        message: `Hàng đợi email có mục chờ ${Math.round(oldest / 60)} phút — worker có thể đang dừng.`,
      });
    if (refManual > 0)
      alerts.push({
        severity: 'critical',
        code: 'REFUND_NEEDS_MANUAL',
        message: `${refManual} yêu cầu hoàn tiền chưa rõ kết quả — đối chiếu với cổng thanh toán và xử lý thủ công.`,
      });
    if (refFailed > 0)
      alerts.push({
        severity: 'warning',
        code: 'REFUND_FAILED',
        message: `${refFailed} yêu cầu hoàn tiền bị từ chối trong 30 ngày qua.`,
      });
    if (payStale > 0)
      alerts.push({
        severity: 'warning',
        code: 'PAYMENT_STALE',
        message: `${payStale} giao dịch online chờ quá 30 phút chưa có kết quả — kiểm tra đối soát.`,
      });
    return {
      outbox: { pending, dead, oldestPendingSeconds: oldest },
      payments: { pending: payPending, stalePending: payStale },
      refunds: { pending: refPending, needsManual: refManual, failed: refFailed },
      orders: Object.fromEntries(byStatus.rows.map((r) => [r.status, Number(r.n)])),
      reservations: { active },
      alerts,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Prometheus text exposition format. */
  async metrics(): Promise<string> {
    const s = await this.status();
    const lines: string[] = [];
    const gauge = (name: string, help: string, value: number, labels = '') => {
      if (!lines.some((l) => l.startsWith(`# HELP ${name} `)))
        lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
      lines.push(`${name}${labels} ${value}`);
    };
    gauge('nona_outbox_pending', 'Outbox events waiting for delivery', s.outbox.pending);
    gauge('nona_outbox_dead', 'Outbox events that exhausted retries', s.outbox.dead);
    gauge(
      'nona_outbox_oldest_pending_seconds',
      'Age of the oldest undelivered outbox event',
      s.outbox.oldestPendingSeconds,
    );
    gauge('nona_payments_pending', 'Online payments awaiting a result', s.payments.pending);
    gauge(
      'nona_payments_stale_pending',
      'Online payments pending for over 30 minutes',
      s.payments.stalePending,
    );
    gauge('nona_refunds_pending', 'Refunds not yet confirmed', s.refunds.pending);
    gauge(
      'nona_refunds_needs_manual',
      'Pending refunds older than 5 minutes (outcome unknown)',
      s.refunds.needsManual,
    );
    gauge(
      'nona_refunds_failed_30d',
      'Refunds refused by the provider in the last 30 days',
      s.refunds.failed,
    );
    gauge('nona_reservations_active', 'Unexpired stock reservations', s.reservations.active);
    for (const [status, n] of Object.entries(s.orders))
      gauge('nona_orders', 'Orders by status', n, `{status="${status}"}`);
    return `${lines.join('\n')}\n`;
  }
}
