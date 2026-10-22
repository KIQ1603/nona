import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../../common/errors/app-error';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { DatabaseService } from '../../../platform/database/database.service';
import { clientIp } from '../../orders/application/orders.service';
import { OrdersRepository } from '../../orders/infrastructure/orders.repository';
import { PaymentGateway } from './payment-gateway';

const MAX_ATTEMPTS = 10;

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(OrdersRepository) private readonly orders: OrdersRepository,
    @Inject(PaymentGateway) private readonly gateway: PaymentGateway,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
  ) {}

  /**
   * (Re)starts payment for an unpaid online order, e.g. after the shopper closed the gateway tab. Each
   * attempt gets its own transaction reference; the hold on the stock is not extended.
   */
  initiate(orderCode: string, key: string, ip?: string) {
    return this.idempotency.run(
      { scope: `pay:${orderCode}` },
      'payments.initiate',
      key,
      { orderCode },
      200,
      async (c) => {
        const order = await this.orders.lockByCode(c as never, orderCode);
        if (!order) throw AppError.notFound('Không tìm thấy đơn hàng.');
        if (order.payment_method !== 'VNPAY' || order.status !== 'PENDING_PAYMENT') {
          throw new AppError('CONFLICT', 409, 'Đơn hàng này không ở trạng thái chờ thanh toán.', {
            status: order.status,
          });
        }
        if (!order.payment_expires_at || order.payment_expires_at.getTime() <= Date.now()) {
          throw new AppError(
            'CONFLICT',
            409,
            'Đã hết thời gian thanh toán cho đơn hàng này. Vui lòng đặt hàng lại.',
            { reason: 'EXPIRED' },
          );
        }
        const count = Number(
          (
            await c.query(
              `SELECT COUNT(*) AS n FROM payments WHERE order_id = $1 AND provider = 'VNPAY'`,
              [order.id],
            )
          ).rows[0].n,
        );
        if (count >= MAX_ATTEMPTS)
          throw new AppError(
            'CONFLICT',
            409,
            'Bạn đã thử thanh toán quá nhiều lần cho đơn hàng này.',
          );
        const attempt = this.gateway.createPayment({
          orderCode: order.public_code,
          attempt: count + 1,
          amountVnd: Number(order.total_vnd),
          ip: clientIp(ip),
          expiresAt: order.payment_expires_at,
        });
        await this.orders.insertPayment(c as never, {
          orderId: order.id,
          provider: 'VNPAY',
          amountVnd: Number(order.total_vnd),
          providerRef: attempt.txnRef,
          idempotencyKey: key,
        });
        return { paymentUrl: attempt.url, expiresAt: order.payment_expires_at.toISOString() };
      },
    );
  }
}
