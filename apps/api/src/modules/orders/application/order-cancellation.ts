import type pg from 'pg';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import type { RefundsService } from '../../payments/application/refunds.service';
import { releasesStockOnCancel } from '../domain/order-state';
import type { OrderRow, OrdersRepository } from '../infrastructure/orders.repository';

export interface CancelResult {
  order: OrderRow;
  /** Set when a paid online order was cancelled: the caller sends this refund to the provider after commit. */
  refundId: string | null;
}

/**
 * Cancels a locked order inside the caller's transaction. Shared by customer and admin paths.
 *  - unpaid online order      -> CANCELLED, hold released (nothing was sold), open payment attempts cancelled
 *  - COD order                -> CANCELLED, sold stock returned to the ledger
 *  - paid online order        -> REFUND_PENDING, stock returned, a full refund is recorded
 * The coupon use is released in every case. The caller has already validated that cancelling is allowed.
 */
export async function cancelOrderInTx(
  repo: OrdersRepository,
  refunds: RefundsService,
  c: pg.PoolClient,
  order: OrderRow,
  actor: { actorType: 'CUSTOMER' | 'ADMIN' | 'SYSTEM'; actorId?: string | null; reason: string },
): Promise<CancelResult> {
  const paid = order.status === 'PENDING_PAYMENT' ? null : await repo.paidPayment(c, order.id);
  const needsRefund = Boolean(paid && paid.provider === 'VNPAY');
  const target = needsRefund ? 'REFUND_PENDING' : 'CANCELLED';

  if (order.status === 'PENDING_PAYMENT') await repo.releaseHold(c, order.id, 'RELEASED');
  else if (releasesStockOnCancel(order.status))
    await repo.releaseSale(c, order.id, order.public_code);
  await c.query(
    `UPDATE payments SET status = 'CANCELLED', updated_at = now() WHERE order_id = $1 AND status = 'PENDING'`,
    [order.id],
  );
  await repo.releaseCouponUsage(c, order.id);

  const updated = await repo.setStatus(c, order.id, target);
  await repo.insertHistory(c, {
    orderId: order.id,
    from: order.status,
    to: target,
    actorType: actor.actorType,
    actorId: actor.actorId,
    reason: actor.reason,
  });
  let refundId: string | null = null;
  if (needsRefund && paid) {
    const remaining = Number(paid.amount_vnd) - Number(paid.refunded_vnd);
    if (remaining > 0)
      refundId = await refunds.createInTx(c, {
        paymentId: paid.id,
        orderId: order.id,
        amountVnd: remaining,
        reason: actor.reason,
        requestedBy: actor.actorType === 'ADMIN' ? actor.actorId : null,
      });
  }
  await enqueueOutbox(c, 'order.status_changed', {
    orderCode: order.public_code,
    email: order.customer_email,
    customerName: order.shipping_address.fullName,
    status: target,
    reason: actor.reason,
  });
  return { order: updated, refundId };
}
