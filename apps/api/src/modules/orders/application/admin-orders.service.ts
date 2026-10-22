import { Inject, Injectable } from '@nestjs/common';
import type { AdminOrderDetail, OrderStatus } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { enqueueOutbox } from '../../../common/outbox/outbox';
import { ENV, type Env } from '../../../config/env';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';
import { allowedTransitions, assertTransition } from '../domain/order-state';
import { OrdersRepository, type OrderRow } from '../infrastructure/orders.repository';
import { RefundsService } from '../../payments/application/refunds.service';
import { cancelOrderInTx } from './order-cancellation';
import { toOrderDto } from './order.mapper';

export interface StatusChange {
  to: OrderStatus;
  version: number;
  reason?: string;
  shipment?: { carrier: string; trackingCode?: string };
}

@Injectable()
export class AdminOrdersService {
  private readonly mediaBase: string;
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OrdersRepository) private readonly repo: OrdersRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RefundsService) private readonly refunds: RefundsService,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  async list(filter: { q?: string; status?: string }, page: number, pageSize: number) {
    const { rows, total } = await this.repo.listAdmin(filter, page, pageSize);
    return {
      items: rows.map((r) => ({
        id: r.id as string,
        code: r.public_code as string,
        status: r.status as OrderStatus,
        customerEmail: r.customer_email as string,
        customerName: (r.customer_name as string) ?? '',
        totalVnd: Number(r.total_vnd),
        itemCount: r.item_count as number,
        paymentMethod: r.payment_method as string,
        paymentStatus: r.payment_status as string,
        placedAt: (r.placed_at as Date).toISOString(),
        version: r.version as number,
        allowedTransitions: [...allowedTransitions(r.status as OrderStatus)],
        pendingDesigns: r.pending_designs as number,
      })),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
  }

  private async detail(
    q: Pick<import('pg').Pool, 'query'>,
    order: OrderRow,
  ): Promise<AdminOrderDetail> {
    const d = await this.repo.details(q, order.id);
    const base = toOrderDto(order, d, { isOwner: true, mediaBase: this.mediaBase }); // staff see full details
    return {
      ...base,
      id: order.id,
      version: order.version,
      userId: order.user_id,
      canCancel: false,
      refunds: d.refunds.map((r) => ({
        id: r.id as string,
        amountVnd: Number(r.amount_vnd),
        status: r.status as 'PENDING' | 'SUCCEEDED' | 'FAILED',
        reason: r.reason as string,
        failureReason: (r.failure_reason as string | null) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        resolvedAt: r.resolved_at ? (r.resolved_at as Date).toISOString() : null,
      })),
      refundableVnd: await this.refundable(q, order.id),
      allowedTransitions: [...allowedTransitions(order.status)],
      pendingDesigns: (
        await q.query(
          `SELECT dv.design_id, dv.id AS version_id, dv.version_no, dv.status
           FROM order_items oi JOIN custom_design_versions dv ON dv.id = oi.design_version_id
           WHERE oi.order_id = $1 AND dv.status <> 'APPROVED' ORDER BY oi.id`,
          [order.id],
        )
      ).rows.map((r) => ({
        designId: r.design_id as string,
        versionId: r.version_id as string,
        versionNo: r.version_no as number,
        status: r.status as string,
      })),
      history: d.history.map((h) => ({
        status: h.to_status as OrderStatus,
        from: (h.from_status as OrderStatus | null) ?? null,
        at: (h.created_at as Date).toISOString(),
        actorType: h.actor_type as string,
        actorEmail: (h.actor_email as string | null) ?? null,
        reason: (h.reason as string | null) ?? null,
      })),
    };
  }

  /** What can still be refunded on the order's paid online payment (0 for COD / unpaid). */
  private async refundable(q: Pick<import('pg').Pool, 'query'>, orderId: string): Promise<number> {
    const pay = await this.repo.paidPayment(q, orderId);
    if (!pay || pay.provider !== 'VNPAY') return 0;
    const pending = Number(
      (
        await q.query(
          `SELECT COALESCE(SUM(amount_vnd),0) AS s FROM refunds WHERE payment_id = $1 AND status = 'PENDING'`,
          [pay.id],
        )
      ).rows[0].s,
    );
    return Math.max(Number(pay.amount_vnd) - Number(pay.refunded_vnd) - pending, 0);
  }

  async get(id: string): Promise<AdminOrderDetail> {
    const order = await this.repo.findById(this.db.pool, id);
    if (!order) throw AppError.notFound('Không tìm thấy đơn hàng.');
    return this.detail(this.db.pool, order);
  }

  /**
   * Moves an order along the validated state machine. Stale versions are rejected (409), cancellations
   * require a reason and return the stock, shipping needs a carrier, completion collects the COD payment.
   */
  async changeStatus(
    id: string,
    change: StatusChange,
    actor: { userId: string; requestId?: string },
  ): Promise<AdminOrderDetail> {
    let refundId: string | null = null;
    const detail = await this.db.transaction(async (c) => {
      const order = await this.repo.lockById(c, id);
      if (!order) throw AppError.notFound('Không tìm thấy đơn hàng.');
      if (order.version !== change.version) {
        throw new AppError(
          'CONFLICT',
          409,
          'Đơn hàng đã được cập nhật bởi người khác. Vui lòng tải lại.',
          { currentVersion: order.version, currentStatus: order.status },
        );
      }
      assertTransition(order.status, change.to);
      if (change.to === 'PROCESSING') {
        // Production must not start on a design that is not (or no longer) approved.
        const bad = await c.query(
          `SELECT 1 FROM order_items oi JOIN custom_design_versions dv ON dv.id = oi.design_version_id WHERE oi.order_id = $1 AND dv.status <> 'APPROVED' LIMIT 1`,
          [id],
        );
        if (bad.rowCount)
          throw new AppError(
            'DESIGN_NOT_APPROVED',
            409,
            'Đơn hàng có thiết kế chưa được duyệt nên chưa thể bắt đầu sản xuất.',
          );
      }

      let updated: OrderRow;
      if (change.to === 'CANCELLED') {
        if (!change.reason)
          throw AppError.validation({
            issues: [{ path: 'reason', message: 'Cần nhập lý do hủy đơn' }],
          });
        const cancelled = await cancelOrderInTx(this.repo, this.refunds, c, order, {
          actorType: 'ADMIN',
          actorId: actor.userId,
          reason: change.reason,
        });
        updated = cancelled.order;
        refundId = cancelled.refundId;
      } else {
        if (change.to === 'SHIPPING' && !change.shipment) {
          throw AppError.validation({
            issues: [
              { path: 'shipment.carrier', message: 'Cần nhập đơn vị vận chuyển khi giao hàng' },
            ],
          });
        }
        const res = await c.query<OrderRow>(
          `UPDATE orders SET status = $1, version = version + 1, updated_at = now() WHERE id = $2 RETURNING *`,
          [change.to, id],
        );
        updated = res.rows[0]!;
        if (change.to === 'SHIPPING' && change.shipment) {
          await c.query(
            `INSERT INTO shipments (order_id, carrier, tracking_code) VALUES ($1,$2,$3)`,
            [id, change.shipment.carrier, change.shipment.trackingCode || null],
          );
        }
        if (change.to === 'COMPLETED') {
          // Cash on delivery: the money is collected when the parcel is handed over.
          await c.query(
            `UPDATE payments SET status = 'PAID', updated_at = now() WHERE order_id = $1 AND status = 'PENDING'`,
            [id],
          );
          await c.query(
            `UPDATE shipments SET status = 'DELIVERED', delivered_at = now() WHERE order_id = $1 AND status = 'SHIPPED'`,
            [id],
          );
        }
        await this.repo.insertHistory(c, {
          orderId: id,
          from: order.status,
          to: change.to,
          actorType: 'ADMIN',
          actorId: actor.userId,
          reason: change.reason ?? null,
        });
        if (change.to === 'SHIPPING' || change.to === 'COMPLETED') {
          await enqueueOutbox(c, 'order.status_changed', {
            orderCode: order.public_code,
            email: order.customer_email,
            customerName: order.shipping_address.fullName,
            status: change.to,
            carrier: change.shipment?.carrier ?? null,
            trackingCode: change.shipment?.trackingCode ?? null,
          });
        }
      }
      await this.audit.record(
        {
          actorId: actor.userId,
          action: 'order.status_change',
          targetType: 'order',
          targetId: id,
          metadata: {
            code: order.public_code,
            from: order.status,
            to: change.to,
            reason: change.reason,
          },
          requestId: actor.requestId,
        },
        c,
      );
      return this.detail(c, updated);
    });
    if (refundId) {
      await this.refunds.process(refundId).catch(() => undefined); // an uncertain/failed refund stays visible to finance
      return this.get(id);
    }
    return detail;
  }

  /** Manual (typically partial) refund of a paid online order. Needs the refunds:write permission. */
  async requestRefund(
    orderId: string,
    input: { amountVnd: number; reason: string },
    key: string,
    actor: { userId: string; requestId?: string },
  ): Promise<AdminOrderDetail> {
    const refundId = await this.db.transaction(async (c) => {
      const order = await this.repo.lockById(c, orderId);
      if (!order) throw AppError.notFound('Không tìm thấy đơn hàng.');
      if (!['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'].includes(order.status)) {
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          409,
          'Chỉ có thể hoàn tiền đơn đã hoàn tất, hoặc đơn đang chờ hoàn tiền.',
          { status: order.status },
        );
      }
      const pay = await this.repo.paidPayment(c, orderId);
      if (!pay || pay.provider !== 'VNPAY')
        throw new AppError(
          'CONFLICT',
          409,
          'Đơn hàng này không có khoản thanh toán online để hoàn tiền.',
        );
      const id = await this.refunds.createInTx(c, {
        paymentId: pay.id,
        orderId,
        amountVnd: input.amountVnd,
        reason: input.reason,
        requestedBy: actor.userId,
        idempotencyKey: key,
      });
      await this.audit.record(
        {
          actorId: actor.userId,
          action: 'refund.request',
          targetType: 'order',
          targetId: orderId,
          metadata: {
            refundId: id,
            amountVnd: input.amountVnd,
            reason: input.reason,
            code: order.public_code,
          },
          requestId: actor.requestId,
        },
        c,
      );
      return id;
    });
    await this.refunds.process(refundId).catch(() => undefined);
    return this.get(orderId);
  }

  async resolveRefund(
    refundId: string,
    outcome: 'SUCCEEDED' | 'FAILED',
    note: string,
    actor: { userId: string; requestId?: string },
  ) {
    await this.refunds.resolveManually(refundId, outcome, note, actor);
    const { rows } = await this.db.query<{ order_id: string }>(
      'SELECT order_id FROM refunds WHERE id = $1',
      [refundId],
    );
    return this.get(rows[0]!.order_id);
  }
}
