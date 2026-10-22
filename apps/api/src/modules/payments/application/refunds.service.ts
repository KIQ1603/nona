import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AppError } from '../../../common/errors/app-error';
import { logger } from '../../../common/logging/logger';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { OrdersRepository, type PaymentRow } from '../../orders/infrastructure/orders.repository';
import { PaymentGateway } from './payment-gateway';

interface RefundRow {
  id: string;
  payment_id: string;
  order_id: string;
  amount_vnd: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
  reason: string;
  requested_by: string | null;
}

/**
 * Refunds are append-only records. A refund changes state only from the provider's confirmation, or from an
 * authorized, audited manual resolution. Money is never refunded twice: capacity is checked under a row lock,
 * and each refund is processed under an advisory lock.
 */
@Injectable()
export class RefundsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Records a PENDING refund inside the caller's transaction, enforcing that it fits what is still refundable. */
  async createInTx(
    c: pg.PoolClient,
    r: {
      paymentId: string;
      orderId: string;
      amountVnd: number;
      reason: string;
      requestedBy?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<string> {
    const pay = (
      await c.query<PaymentRow>('SELECT * FROM payments WHERE id = $1 FOR UPDATE', [r.paymentId])
    ).rows[0];
    if (!pay || (pay.status !== 'PAID' && pay.status !== 'REFUNDED'))
      throw new AppError('CONFLICT', 409, 'Khoản thanh toán này chưa thể hoàn tiền.');
    const pending = Number(
      (
        await c.query(
          `SELECT COALESCE(SUM(amount_vnd),0) AS s FROM refunds WHERE payment_id = $1 AND status = 'PENDING'`,
          [r.paymentId],
        )
      ).rows[0].s,
    );
    const refundable = Number(pay.amount_vnd) - Number(pay.refunded_vnd) - pending;
    if (r.amountVnd > refundable) {
      throw new AppError('CONFLICT', 409, 'Số tiền hoàn vượt quá số tiền còn có thể hoàn.', {
        refundableVnd: Math.max(refundable, 0),
      });
    }
    try {
      const { rows } = await c.query(
        `INSERT INTO refunds (payment_id, order_id, amount_vnd, reason, requested_by, idempotency_key) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [
          r.paymentId,
          r.orderId,
          r.amountVnd,
          r.reason,
          r.requestedBy ?? null,
          r.idempotencyKey ?? null,
        ],
      );
      return rows[0].id;
    } catch (e) {
      if ((e as { constraint?: string }).constraint === 'refunds_idempotency_key')
        throw new AppError('CONFLICT', 409, 'Yêu cầu hoàn tiền này đã được ghi nhận.');
      throw e;
    }
  }

  /** Sends one PENDING refund to the provider. Safe to call repeatedly and concurrently. */
  async process(refundId: string): Promise<void> {
    const client = await this.db.pool.connect();
    try {
      const lock = await client.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS ok`, [
        `refund:${refundId}`,
      ]);
      if (!lock.rows[0].ok) return; // another worker is on it
      try {
        const refund = (
          await client.query<RefundRow>('SELECT * FROM refunds WHERE id = $1', [refundId])
        ).rows[0];
        if (!refund || refund.status !== 'PENDING') return;
        const pay = (
          await client.query<PaymentRow>('SELECT * FROM payments WHERE id = $1', [
            refund.payment_id,
          ])
        ).rows[0]!;
        const order = (
          await client.query('SELECT public_code FROM orders WHERE id = $1', [refund.order_id])
        ).rows[0];
        if (!pay.provider_ref || !pay.provider_transaction_no || !pay.paid_at) {
          await this.finish(
            client,
            refund,
            false,
            'Thiếu thông tin giao dịch gốc để hoàn tiền tự động',
            null,
            null,
          );
          return;
        }
        // Stamp the attempt BEFORE calling the provider. If we crash or time out afterwards we do not know
        // whether the money moved, so this refund is never auto-retried; finance resolves it manually.
        const claim = await client.query(
          `UPDATE refunds SET attempted_at = now() WHERE id = $1 AND status = 'PENDING' AND attempted_at IS NULL`,
          [refundId],
        );
        if (claim.rowCount !== 1) return;
        const amount = Number(refund.amount_vnd);
        const result = await this.gateway.refund({
          txnRef: pay.provider_ref,
          amountVnd: amount,
          full: amount === Number(pay.amount_vnd),
          transactionNo: pay.provider_transaction_no,
          paidAt: pay.paid_at,
          requestedBy: 'nona-system',
          orderCode: order.public_code,
        });
        if (result.uncertain) {
          // Outcome unknown (timeout / bad signature): never mark failed or retry blindly; finance resolves it manually.
          logger.error(
            { refundId, orderId: refund.order_id, message: result.message },
            'refund outcome uncertain - needs manual resolution',
          );
          return;
        }
        await this.finish(
          client,
          refund,
          result.ok,
          result.ok ? null : result.message || 'Nhà cung cấp từ chối hoàn tiền',
          result.providerRef,
          null,
        );
      } finally {
        await client.query(`SELECT pg_advisory_unlock(hashtext($1))`, [`refund:${refundId}`]);
      }
    } finally {
      client.release();
    }
  }

  /** Authorized, audited manual resolution of a refund the provider could not confirm. */
  async resolveManually(
    refundId: string,
    outcome: 'SUCCEEDED' | 'FAILED',
    note: string,
    actor: { userId: string; requestId?: string },
  ): Promise<void> {
    const client = await this.db.pool.connect();
    try {
      const refund = (
        await client.query<RefundRow>('SELECT * FROM refunds WHERE id = $1', [refundId])
      ).rows[0];
      if (!refund) throw AppError.notFound('Không tìm thấy yêu cầu hoàn tiền.');
      if (refund.status !== 'PENDING')
        throw new AppError('CONFLICT', 409, 'Yêu cầu hoàn tiền này đã được xử lý.');
      await this.finish(
        client,
        refund,
        outcome === 'SUCCEEDED',
        outcome === 'FAILED' ? note : null,
        null,
        actor,
        note,
      );
    } finally {
      client.release();
    }
  }

  private async finish(
    client: pg.PoolClient,
    refund: RefundRow,
    ok: boolean,
    failure: string | null,
    providerRef: string | null,
    manual: { userId: string; requestId?: string } | null,
    note?: string,
  ) {
    await client.query('BEGIN');
    try {
      const cur = (
        await client.query<RefundRow>('SELECT * FROM refunds WHERE id = $1 FOR UPDATE', [refund.id])
      ).rows[0]!;
      if (cur.status !== 'PENDING') {
        await client.query('ROLLBACK');
        return;
      }
      await client.query(
        `UPDATE refunds SET status = $2, resolved_at = now(), provider_ref = $3, failure_reason = $4 WHERE id = $1`,
        [refund.id, ok ? 'SUCCEEDED' : 'FAILED', providerRef, failure],
      );
      const amount = Number(refund.amount_vnd);
      const order = await this.orders.lockById(client, refund.order_id);
      if (ok) {
        const pay = (
          await client.query<PaymentRow>(
            `UPDATE payments SET refunded_vnd = refunded_vnd + $2, status = CASE WHEN refunded_vnd + $2 >= amount_vnd THEN 'REFUNDED' ELSE status END, updated_at = now() WHERE id = $1 RETURNING *`,
            [refund.payment_id, amount],
          )
        ).rows[0]!;
        const full = Number(pay.refunded_vnd) >= Number(pay.amount_vnd);
        if (order && ['REFUND_PENDING', 'COMPLETED', 'PARTIALLY_REFUNDED'].includes(order.status)) {
          const next = full ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
          if (next !== order.status) {
            await this.orders.setStatus(client, order.id, next);
            await this.orders.insertHistory(client, {
              orderId: order.id,
              from: order.status,
              to: next,
              actorType: manual ? 'ADMIN' : 'SYSTEM',
              actorId: manual?.userId,
              reason: `Hoàn tiền ${new Intl.NumberFormat('vi-VN').format(amount)}đ`,
              metadata: { refundId: refund.id },
            });
            await enqueueOutbox(client, 'order.status_changed', {
              orderCode: order.public_code,
              email: order.customer_email,
              customerName: order.shipping_address.fullName,
              status: next,
              amountVnd: amount,
            });
          }
        }
      }
      await this.audit.record(
        {
          actorId: manual?.userId ?? null,
          action: manual ? 'refund.resolve_manual' : ok ? 'refund.succeeded' : 'refund.failed',
          targetType: 'order',
          targetId: refund.order_id,
          metadata: {
            refundId: refund.id,
            amountVnd: amount,
            outcome: ok ? 'SUCCEEDED' : 'FAILED',
            failure,
            note,
          },
          requestId: manual?.requestId,
        },
        client,
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}
