import Link from 'next/link';
import type { CSSProperties } from 'react';
import { formatVnd, ORDER_STATUS_LABELS, type OrderDto, type OrderStatus } from '@nona/contracts';
import { CancelOrderButton } from './cancel-order-button';
import { CustomizationNote } from './customization-note';
import { PaymentPanel } from './payment-panel';

const COD_FLOW: OrderStatus[] = [
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPING',
  'COMPLETED',
];
const ONLINE_FLOW: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', ...COD_FLOW];
const group = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');
const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

const OFF_PATH: Partial<Record<OrderStatus, { tone: 'bad' | 'info'; text: string }>> = {
  CANCELLED: { tone: 'bad', text: 'Đơn hàng này đã được hủy.' },
  EXPIRED: {
    tone: 'bad',
    text: 'Đơn hàng đã hết hạn do chưa được thanh toán kịp thời. Nếu bạn đã bị trừ tiền, hệ thống sẽ tự động hoàn lại.',
  },
  REFUND_PENDING: {
    tone: 'info',
    text: 'Đơn hàng đã hủy. Chúng tôi đang hoàn tiền về phương thức bạn đã thanh toán — thường mất vài ngày làm việc tùy ngân hàng.',
  },
  REFUNDED: { tone: 'info', text: 'Đơn hàng đã được hoàn tiền đầy đủ.' },
  PARTIALLY_REFUNDED: { tone: 'info', text: 'Đơn hàng đã được hoàn tiền một phần.' },
  PAYMENT_FAILED: { tone: 'bad', text: 'Thanh toán không thành công.' },
};

function paymentLabel(order: OrderDto): string {
  if (order.paymentMethod === 'COD') {
    return `Khi nhận hàng (COD) — ${order.paymentStatus === 'PAID' ? 'đã thu tiền' : order.paymentStatus === 'CANCELLED' ? 'đã hủy' : 'chưa thu'}`;
  }
  const state: Record<string, string> = {
    PENDING: 'chờ thanh toán',
    PAID: 'đã thanh toán',
    FAILED: 'chưa thành công',
    CANCELLED: 'đã hủy',
    REFUNDED: 'đã hoàn tiền',
  };
  return `Trực tuyến qua VNPay — ${state[order.paymentStatus] ?? order.paymentStatus}`;
}

export function OrderView({
  order,
  justPlaced = false,
  returning = false,
}: {
  order: OrderDto;
  justPlaced?: boolean;
  returning?: boolean;
}) {
  const offPath = OFF_PATH[order.status];
  const reached = new Map(order.history.map((h) => [h.status, h.at]));
  const online = order.paymentMethod === 'VNPAY';
  const flow = online ? ONLINE_FLOW : COD_FLOW;
  const currentIndex = flow.indexOf(order.status);
  const awaitingPayment = order.status === 'PENDING_PAYMENT';

  return (
    <div className="order-page">
      {justPlaced && !awaitingPayment && (
        <div className="order-thanks" role="status">
          <span aria-hidden="true">✦</span>
          <h1>Cảm ơn bạn đã đặt hàng!</h1>
          <p>
            Chúng tôi đã gửi email xác nhận tới <strong>{order.customerEmail}</strong>. Hãy lưu lại
            mã đơn hàng bên dưới để theo dõi.
          </p>
        </div>
      )}
      {online && order.status === 'CONFIRMED' && returning && !justPlaced && (
        <div className="order-thanks" role="status">
          <span aria-hidden="true">✦</span>
          <h1>Thanh toán thành công!</h1>
          <p>
            Cảm ơn bạn. Chúng tôi đã nhận được thanh toán và đang chuẩn bị đơn hàng. Email xác nhận
            được gửi tới <strong>{order.customerEmail}</strong>.
          </p>
        </div>
      )}
      <div className="order-head">
        <div>
          <p className="eyebrow">Mã đơn hàng</p>
          {justPlaced ? (
            <p className="order-code">{group(order.code)}</p>
          ) : (
            <h1 className="order-code">{group(order.code)}</h1>
          )}
          <p className="order-meta">Đặt lúc {when(order.placedAt)}</p>
        </div>
        <span
          className={`status-chip ${['CANCELLED', 'EXPIRED', 'PAYMENT_FAILED'].includes(order.status) ? 'cancelled' : order.status === 'COMPLETED' ? 'done' : ''}`}
        >
          {ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      {awaitingPayment && (
        <PaymentPanel
          code={order.code}
          expiresAt={order.paymentExpiresAt}
          lastAttemptFailed={order.paymentStatus === 'FAILED'}
          returning={returning}
          totalVnd={order.totalVnd}
        />
      )}

      {offPath ? (
        <p className={offPath.tone === 'bad' ? 'form-error' : 'form-note'}>
          {offPath.text}
          {reached.get(order.status) ? ` (${when(reached.get(order.status)!)})` : ''}
        </p>
      ) : (
        <ol
          className="timeline"
          aria-label="Tiến trình đơn hàng"
          style={{ '--order-step-count': flow.length } as CSSProperties}
        >
          {flow.map((s, i) => (
            <li
              key={s}
              className={i <= currentIndex ? 'reached' : ''}
              aria-current={i === currentIndex ? 'step' : undefined}
            >
              <span className="dot" aria-hidden="true" />
              <strong>{ORDER_STATUS_LABELS[s]}</strong>
              {reached.get(s) && <small>{when(reached.get(s)!)}</small>}
            </li>
          ))}
        </ol>
      )}

      {order.shipment && (
        <p className="panel-note">
          Đơn vị vận chuyển: <strong>{order.shipment.carrier}</strong>
          {order.shipment.trackingCode && (
            <>
              {' '}
              · Mã vận đơn: <strong>{order.shipment.trackingCode}</strong>
            </>
          )}
        </p>
      )}

      <div className="order-grid">
        <section className="panel order-products">
          <h2>Sản phẩm</h2>
          <ul className="summary-lines">
            {order.items.map((i) => (
              <li key={i.sku}>
                <div className="thumb-sm">
                  {i.imageUrl && (
                    <img src={i.imageUrl} alt="" width={96} height={96} loading="lazy" />
                  )}
                </div>
                <div>
                  <strong>{i.productName}</strong>
                  <small>
                    {i.variantName !== 'Tiêu chuẩn' ? `${i.variantName} · ` : ''}
                    {formatVnd(i.unitPriceVnd)} × {i.quantity}
                  </small>
                </div>
                <span>{formatVnd(i.lineTotalVnd)}</span>
                {i.customization && <CustomizationNote c={i.customization} />}
              </li>
            ))}
          </ul>
        </section>
        <aside className="order-sidebar" aria-label="Thông tin đơn hàng">
          <section className="panel order-delivery">
            <h2>Thông tin giao hàng</h2>
            <dl className="order-facts">
              <div>
                <dt>Người nhận</dt>
                <dd>{order.shippingAddress.fullName}</dd>
              </div>
              <div>
                <dt>Số điện thoại</dt>
                <dd>{order.shippingAddress.phone}</dd>
              </div>
              <div>
                <dt>Địa chỉ giao hàng</dt>
                <dd>
                  {order.shippingAddress.line1}, {order.shippingAddress.ward},{' '}
                  {order.shippingAddress.district}, {order.shippingAddress.province}
                </dd>
              </div>
              {order.customerNote && (
                <div>
                  <dt>Ghi chú của bạn</dt>
                  <dd>{order.customerNote}</dd>
                </div>
              )}
            </dl>
            {!order.isOwner && (
              <p className="fine-print">
                Một số thông tin được ẩn để bảo vệ quyền riêng tư.{' '}
                <Link href={`/dang-nhap?next=/don-hang/${order.code}`}>Đăng nhập</Link> nếu đây là
                đơn của bạn.
              </p>
            )}
          </section>
          <section className="panel order-payment">
            <h2>Thanh toán</h2>
            <p className="order-payment-method">{paymentLabel(order)}</p>
            <dl className="summary-totals">
              <div>
                <dt>Tạm tính</dt>
                <dd>{formatVnd(order.subtotalVnd)}</dd>
              </div>
              {order.discountVnd > 0 && (
                <div>
                  <dt>Giảm giá{order.couponCode ? ` (${order.couponCode})` : ''}</dt>
                  <dd>−{formatVnd(order.discountVnd)}</dd>
                </div>
              )}
              <div>
                <dt>Phí vận chuyển</dt>
                <dd>{order.shippingFeeVnd === 0 ? 'Miễn phí' : formatVnd(order.shippingFeeVnd)}</dd>
              </div>
              <div className="grand">
                <dt>Tổng cộng</dt>
                <dd>{formatVnd(order.totalVnd)}</dd>
              </div>
              {order.refundedVnd > 0 && (
                <div>
                  <dt>Đã hoàn tiền</dt>
                  <dd>{formatVnd(order.refundedVnd)}</dd>
                </div>
              )}
            </dl>
          </section>
          {order.canCancel && (
            <div className="order-cancel">
              <CancelOrderButton code={order.code} />
            </div>
          )}
        </aside>
      </div>
      <p>
        <Link className="btn btn-outline-site" href="/shop">
          Tiếp tục mua sắm
        </Link>
      </p>
    </div>
  );
}
