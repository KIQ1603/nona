import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { logger } from '../../../common/logging/logger';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { DatabaseService } from '../../../platform/database/database.service';
import { orderPlacedPayload } from '../../orders/application/order-events';
import {
  OrdersRepository,
  type OrderRow,
  type PaymentRow,
} from '../../orders/infrastructure/orders.repository';
import { PaymentGateway } from './payment-gateway';
import { RefundsService } from './refunds.service';

/** VNPay IPN acknowledgement codes. 00 and 02 both tell VNPay to stop retrying. */
export type Ack = { RspCode: '00' | '01' | '02' | '04' | '97' | '99'; Message: string };
const ACK = {
  ok: { RspCode: '00', Message: 'Confirm Success' } as Ack,
  duplicate: { RspCode: '02', Message: 'Order already confirmed' } as Ack,
  notFound: { RspCode: '01', Message: 'Order not found' } as Ack,
  amount: { RspCode: '04', Message: 'Invalid amount' } as Ack,
  signature: { RspCode: '97', Message: 'Invalid signature' } as Ack,
  error: { RspCode: '99', Message: 'Unknown error' } as Ack,
};

interface Settled {
  ack: Ack;
  refundIds: string[];
}

/**
 * Turns provider facts into order state, exactly once. Used by the IPN webhook (push) and by
 * reconciliation (pull). Every path is idempotent: provider events are deduplicated in payment_events
 * and the payment/order rows are locked while we decide.
 */
@Injectable()
export class SettlementService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(RefundsService) private readonly refunds: RefundsService,
  ) {}

  // ---- IPN webhook --------------------------------------------------------------------------------

  async handleIpn(params: Record<string, string | undefined>): Promise<Ack> {
    if (!this.gateway.verify(params)) {
      logger.warn({ txnRef: params.vnp_TxnRef }, 'payment callback rejected: invalid signature');
      return ACK.signature;
    }
    const cb = this.gateway.parse(params);
    if (cb.tmnCode !== this.gateway.config.tmnCode) return ACK.error;
    try {
      const settled = cb.success
        ? await this.settleSuccess(cb.txnRef, {
            transactionNo: cb.transactionNo,
            amountVnd: cb.amountVnd,
            source: 'ipn',
          })
        : await this.settleFailure(cb.txnRef, cb.responseCode, cb.amountVnd);
      for (const id of settled.refundIds)
        await this.refunds
          .process(id)
          .catch((e) => logger.error({ err: e, refundId: id }, 'refund processing failed'));
      return settled.ack;
    } catch (error) {
      logger.error({ err: error, txnRef: cb.txnRef }, 'payment callback processing failed');
      return ACK.error; // VNPay will retry the IPN
    }
  }

  // ---- success ------------------------------------------------------------------------------------

  async settleSuccess(
    txnRef: string,
    info: { transactionNo: string | null; amountVnd: number | null; source: 'ipn' | 'reconcile' },
  ): Promise<Settled> {
    return this.db.transaction(async (c) => {
      const pay = (
        await c.query<PaymentRow>(
          `SELECT * FROM payments WHERE provider = 'VNPAY' AND provider_ref = $1 FOR UPDATE`,
          [txnRef],
        )
      ).rows[0];
      if (!pay) return { ack: ACK.notFound, refundIds: [] };
      if (info.amountVnd === null || info.amountVnd !== Number(pay.amount_vnd)) {
        await this.event(c, `amount:${txnRef}:${info.amountVnd}`, pay.id, 'AMOUNT_MISMATCH', {
          amountVnd: info.amountVnd,
          expected: Number(pay.amount_vnd),
        });
        logger.error(
          { txnRef, got: info.amountVnd, expected: Number(pay.amount_vnd) },
          'payment amount mismatch - NOT settled',
        );
        return { ack: ACK.amount, refundIds: [] };
      }
      if (
        !(await this.event(c, `success:${txnRef}`, pay.id, 'SUCCESS', {
          source: info.source,
          transactionNo: info.transactionNo,
        })) ||
        pay.status === 'PAID' ||
        pay.status === 'REFUNDED'
      ) {
        return { ack: ACK.duplicate, refundIds: [] };
      }

      const order = (await this.orders.lockById(c, pay.order_id))!;
      await c.query(
        `UPDATE payments SET status = 'PAID', paid_at = now(), provider_transaction_no = $2, updated_at = now() WHERE id = $1`,
        [pay.id, info.transactionNo],
      );
      const refundIds: string[] = [];

      if (order.status === 'PENDING_PAYMENT' || order.status === 'EXPIRED') {
        const lines = await this.orders.lockOrderLines(c, order.id);
        const stockOk = lines.every((l) => l.active && l.available >= l.quantity);
        if (stockOk) {
          await this.confirm(c, order, info.source);
        } else {
          refundIds.push(
            await this.refundLate(
              c,
              order,
              pay,
              'Thanh toán đến sau khi hết thời gian giữ hàng và sản phẩm đã hết',
            ),
          );
        }
      } else if (order.status === 'CANCELLED') {
        refundIds.push(
          await this.refundLate(c, order, pay, 'Thanh toán đến sau khi đơn hàng đã bị hủy'),
        );
      } else {
        // The order is already paid (e.g. two attempts both succeeded): give this payment back.
        refundIds.push(
          await this.refunds.createInTx(c, {
            paymentId: pay.id,
            orderId: order.id,
            amountVnd: Number(pay.amount_vnd),
            reason: 'Thanh toán trùng cho cùng một đơn hàng',
          }),
        );
        logger.warn(
          { orderCode: order.public_code, txnRef },
          'duplicate payment detected - refund queued',
        );
      }
      return { ack: ACK.ok, refundIds };
    });
  }

  /** PENDING_PAYMENT/EXPIRED -> PAID -> CONFIRMED: sell the stock, send the confirmation. */
  private async confirm(c: pg.PoolClient, order: OrderRow, source: string) {
    await this.orders.consumeReservation(c, order.id, order.public_code);
    if (order.status === 'EXPIRED')
      await c.query(
        `UPDATE coupon_usages SET status = 'APPLIED', released_at = NULL WHERE order_id = $1 AND status = 'RELEASED'`,
        [order.id],
      );
    const paid = await this.orders.setStatus(c, order.id, 'PAID');
    await this.orders.insertHistory(c, {
      orderId: order.id,
      from: order.status,
      to: 'PAID',
      actorType: 'SYSTEM',
      reason: 'Đã nhận thanh toán',
      metadata: { source },
    });
    await this.orders.setStatus(c, order.id, 'CONFIRMED');
    await this.orders.insertHistory(c, {
      orderId: order.id,
      from: 'PAID',
      to: 'CONFIRMED',
      actorType: 'SYSTEM',
      reason: 'Tự động xác nhận sau thanh toán',
    });
    await c.query('UPDATE orders SET payment_expires_at = NULL WHERE id = $1', [order.id]);
    const d = await this.orders.details(c, order.id);
    await enqueueOutbox(
      c,
      'order.placed',
      orderPlacedPayload({ ...paid, status: 'CONFIRMED' }, d.items),
    );
  }

  /** Money arrived for an order that can no longer be fulfilled: record it and refund in full. */
  private async refundLate(
    c: pg.PoolClient,
    order: OrderRow,
    pay: PaymentRow,
    reason: string,
  ): Promise<string> {
    await this.orders.releaseHold(c, order.id, 'EXPIRED');
    await this.orders.releaseCouponUsage(c, order.id);
    if (order.status !== 'REFUND_PENDING') {
      await this.orders.setStatus(c, order.id, 'REFUND_PENDING');
      await this.orders.insertHistory(c, {
        orderId: order.id,
        from: order.status,
        to: 'REFUND_PENDING',
        actorType: 'SYSTEM',
        reason,
      });
    }
    await enqueueOutbox(c, 'order.status_changed', {
      orderCode: order.public_code,
      email: order.customer_email,
      customerName: order.shipping_address.fullName,
      status: 'REFUND_PENDING',
      reason,
    });
    return this.refunds.createInTx(c, {
      paymentId: pay.id,
      orderId: order.id,
      amountVnd: Number(pay.amount_vnd),
      reason,
    });
  }

  // ---- failure ------------------------------------------------------------------------------------

  /**
   * A payment attempt failed or was abandoned at the gateway. The order itself stays PENDING_PAYMENT, so
   * the customer can try again until the hold expires (a deliberate choice recorded in domain-rules.md).
   */
  async settleFailure(
    txnRef: string,
    responseCode: string,
    amountVnd: number | null,
  ): Promise<Settled> {
    return this.db.transaction(async (c) => {
      const pay = (
        await c.query<PaymentRow>(
          `SELECT * FROM payments WHERE provider = 'VNPAY' AND provider_ref = $1 FOR UPDATE`,
          [txnRef],
        )
      ).rows[0];
      if (!pay) return { ack: ACK.notFound, refundIds: [] };
      if (amountVnd !== null && amountVnd !== Number(pay.amount_vnd))
        return { ack: ACK.amount, refundIds: [] };
      if (
        !(await this.event(c, `fail:${txnRef}:${responseCode}`, pay.id, 'FAILED', { responseCode }))
      )
        return { ack: ACK.duplicate, refundIds: [] };
      if (pay.status === 'PENDING')
        await c.query(`UPDATE payments SET status = 'FAILED', updated_at = now() WHERE id = $1`, [
          pay.id,
        ]);
      return { ack: ACK.ok, refundIds: [] };
    });
  }

  /** Inserts a provider event once. Returns false if it was already processed. */
  private async event(
    c: pg.PoolClient,
    key: string,
    paymentId: string,
    outcome: string,
    payload: object,
  ): Promise<boolean> {
    const res = await c.query(
      `INSERT INTO payment_events (provider, event_key, payment_id, outcome, payload) VALUES ('VNPAY',$1,$2,$3,$4::jsonb) ON CONFLICT (provider, event_key) DO NOTHING`,
      [key, paymentId, outcome, JSON.stringify(payload)],
    );
    return res.rowCount === 1;
  }

  // ---- scheduled work (called by the worker through the internal jobs endpoint) -------------------

  /** Pull model: ask the provider about payments still pending after a while; never trust redirects alone. */
  async reconcile(limit = 50) {
    const stats = { checked: 0, settled: 0, failed: 0, abandoned: 0, unknown: 0 };
    const { rows } = await this.db.query<
      PaymentRow & { public_code: string; window_minutes: number }
    >(
      `SELECT p.*, o.public_code FROM payments p JOIN orders o ON o.id = p.order_id
       WHERE p.provider = 'VNPAY' AND p.status = 'PENDING' AND p.provider_ref IS NOT NULL AND p.created_at < now() - interval '5 minutes'
         AND COALESCE((p.metadata->>'lastReconciledAt')::timestamptz, 'epoch') < now() - interval '2 minutes'
       ORDER BY p.created_at LIMIT $1`,
      [limit],
    );
    for (const p of rows) {
      stats.checked++;
      await this.db.query(
        `UPDATE payments SET metadata = metadata || jsonb_build_object('lastReconciledAt', now()) WHERE id = $1`,
        [p.id],
      );
      const q = await this.gateway.query(p.provider_ref!, p.created_at, p.public_code);
      if (q.status === 'SUCCESS') {
        const s = await this.settleSuccess(p.provider_ref!, {
          transactionNo: q.transactionNo,
          amountVnd: q.amountVnd,
          source: 'reconcile',
        });
        for (const id of s.refundIds)
          await this.refunds
            .process(id)
            .catch((e) => logger.error({ err: e, refundId: id }, 'refund processing failed'));
        stats.settled++;
      } else if (q.status === 'FAILED') {
        await this.settleFailure(p.provider_ref!, 'RECON', q.amountVnd);
        stats.failed++;
      } else if (q.status === 'NOT_FOUND' && p.created_at.getTime() < Date.now() - 60 * 60_000) {
        // The shopper never reached the gateway and the hold is long gone.
        await this.db.query(
          `UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE id = $1 AND status = 'PENDING'`,
          [p.id],
        );
        stats.abandoned++;
      } else {
        stats.unknown++;
      }
    }
    return stats;
  }

  /** Online orders whose payment window ran out: release the stock hold and the coupon. */
  async expireUnpaid(limit = 100): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM orders WHERE status = 'PENDING_PAYMENT' AND payment_expires_at < now() - interval '1 minute' ORDER BY payment_expires_at LIMIT $1`,
      [limit],
    );
    let expired = 0;
    for (const { id } of rows) {
      const done = await this.db.transaction(async (c) => {
        const order = await this.orders.lockById(c, id);
        if (!order || order.status !== 'PENDING_PAYMENT') return false;
        await this.orders.setStatus(c, id, 'EXPIRED');
        await this.orders.insertHistory(c, {
          orderId: id,
          from: 'PENDING_PAYMENT',
          to: 'EXPIRED',
          actorType: 'SYSTEM',
          reason: 'Hết thời gian thanh toán',
        });
        await this.orders.releaseHold(c, id, 'EXPIRED');
        await c.query(
          `UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1 AND status = 'PENDING'`,
          [id],
        );
        await this.orders.releaseCouponUsage(c, id);
        return true;
      });
      if (done) expired++;
    }
    return expired;
  }

  /** Sends refunds that were queued but never attempted (e.g. the process stopped right after commit). Attempted ones are never retried. */
  async retryPendingRefunds(limit = 20): Promise<number> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM refunds WHERE status = 'PENDING' AND attempted_at IS NULL AND created_at < now() - interval '2 minutes' ORDER BY created_at LIMIT $1`,
      [limit],
    );
    for (const r of rows)
      await this.refunds
        .process(r.id)
        .catch((e) => logger.error({ err: e, refundId: r.id }, 'refund retry failed'));
    return rows.length;
  }
}
