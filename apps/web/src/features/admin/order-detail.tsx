'use client';

import {
  formatVnd,
  ORDER_STATUS_LABELS,
  type AdminOrderDetail,
  type OrderStatus,
} from '@nona/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AnchoredMenu } from '@/components/admin/anchored-menu';
import { useToast } from '@/components/ui/toast';
import { CustomizationNote } from '@/features/orders/customization-note';
import { useAdmin } from '@/lib/admin-client';
import {
  ACTION_LABEL,
  blockedReason,
  StatusBadge,
  StatusMenu,
  useStatusChange,
} from './order-status';
import { RefundPanel } from './refund-panel';

const group = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');
const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });

const COD_FLOW: OrderStatus[] = [
  'CONFIRMED',
  'PROCESSING',
  'READY_TO_SHIP',
  'SHIPPING',
  'COMPLETED',
];
const ONLINE_FLOW: OrderStatus[] = ['PENDING_PAYMENT', 'PAID', ...COD_FLOW];
const OFF_PATH: Partial<Record<OrderStatus, string>> = {
  CANCELLED: 'Đơn hàng đã bị hủy.',
  EXPIRED: 'Đơn hàng đã hết hạn giữ chỗ do chưa thanh toán.',
  PAYMENT_FAILED: 'Thanh toán không thành công.',
  REFUND_PENDING: 'Đơn đang chờ hoàn tiền.',
  PARTIALLY_REFUNDED: 'Đơn đã được hoàn tiền một phần.',
  REFUNDED: 'Đơn đã được hoàn tiền.',
  CANCELLATION_REQUESTED: 'Khách đã yêu cầu hủy đơn.',
};
const PAYMENT_TEXT: Record<string, string> = {
  PAID: 'Đã thu',
  PENDING: 'Chưa thu',
  FAILED: 'Thất bại',
  REFUNDED: 'Đã hoàn',
};
const ACTOR: Record<string, string> = {
  SYSTEM: 'Hệ thống',
  CUSTOMER: 'Khách hàng',
  GUEST: 'Khách vãng lai',
};

function Stepper({ order }: { order: AdminOrderDetail }) {
  const flow = order.paymentMethod === 'VNPAY' ? ONLINE_FLOW : COD_FLOW;
  if (OFF_PATH[order.status])
    return (
      <div
        className={`od-offpath st-${order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.status === 'PAYMENT_FAILED' ? 'red' : 'orange'}`}
      >
        {OFF_PATH[order.status]}
      </div>
    );
  const at = flow.indexOf(order.status);
  const doneAt = (s: OrderStatus) => order.history.find((h) => h.status === s)?.at;
  return (
    <ol className="od-stepper" aria-label="Tiến trình đơn hàng">
      {flow.map((s, i) => (
        <li key={s} className={i < at ? 'done' : i === at ? 'current' : ''}>
          <span className="dot">{i < at ? '✓' : i + 1}</span>
          <strong>{ORDER_STATUS_LABELS[s]}</strong>
          <small>{doneAt(s) ? when(doneAt(s)!) : ''}</small>
        </li>
      ))}
    </ol>
  );
}

export function OrderDetail({ initial }: { initial: AdminOrderDetail }) {
  const { can } = useAdmin();
  const router = useRouter();
  const toast = useToast();
  const [order, setOrder] = useState(initial);
  const writable = can('orders:write');
  const more = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);

  // coming back from approving a design: fetch the fresh state instead of showing the cached page
  const waitingForDesign = initial.pendingDesigns.length > 0;
  useEffect(() => {
    if (waitingForDesign) router.refresh();
  }, [waitingForDesign, router]);

  const subject = { ...order, pendingDesigns: order.pendingDesigns.length };
  const change = useStatusChange(subject, setOrder);
  // the forward step is the first allowed one that is not a cancellation
  const next = writable ? order.allowedTransitions.find((t) => t !== 'CANCELLED') : undefined;
  const canCancel = writable && order.allowedTransitions.includes('CANCELLED');
  const nextBlocked = next ? blockedReason(subject, next) : null;
  const a = order.shippingAddress;
  const itemCount = order.items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="od">
      <p className="od-back">
        <Link href="/admin/orders">← Đơn hàng</Link>
      </p>

      <header className="od-head">
        <div className="od-title">
          <p className="od-eyebrow">Mã đơn hàng</p>
          <h1>
            {group(order.code)}
            <button
              type="button"
              className="od-copy"
              title="Sao chép mã đơn"
              aria-label="Sao chép mã đơn"
              onClick={async () => {
                await navigator.clipboard?.writeText(order.code).catch(() => undefined);
                toast('Đã sao chép mã đơn');
              }}
            >
              ⧉
            </button>
          </h1>
          <p className="od-meta">
            <StatusMenu order={subject} onChanged={setOrder} writable={writable} />
            <span>Đặt lúc {when(order.placedAt)}</span>
            <span>
              {order.paymentMethod === 'VNPAY'
                ? 'Thanh toán VNPay'
                : 'Thanh toán khi nhận hàng (COD)'}
            </span>
            <span>{order.userId ? 'Khách có tài khoản' : 'Khách vãng lai'}</span>
          </p>
        </div>
        <div className="od-actions">
          {next && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={change.pending || Boolean(nextBlocked)}
              title={nextBlocked ?? undefined}
              onClick={() => change.start(next)}
            >
              {ACTION_LABEL[next] ?? ORDER_STATUS_LABELS[next]}
            </button>
          )}
          <button
            ref={more}
            type="button"
            className="row-more big"
            aria-label="Thêm thao tác"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(!moreOpen)}
          >
            ⋯
          </button>
          <AnchoredMenu
            open={moreOpen}
            anchor={more}
            align="right"
            onClose={() => setMoreOpen(false)}
            label="Thao tác"
          >
            <button
              type="button"
              role="menuitem"
              className="am-item"
              onClick={() => {
                setMoreOpen(false);
                window.print();
              }}
            >
              <span aria-hidden="true">🖨</span>
              <span>In đơn hàng</span>
            </button>
            {canCancel && (
              <button
                type="button"
                role="menuitem"
                className="am-item danger"
                onClick={() => {
                  setMoreOpen(false);
                  change.start('CANCELLED');
                }}
              >
                <span aria-hidden="true">✕</span>
                <span>Hủy đơn</span>
              </button>
            )}
          </AnchoredMenu>
        </div>
      </header>
      {change.dialogNode}
      {change.error && (
        <p className="form-error" role="alert">
          {change.error}
        </p>
      )}

      <Stepper order={order} />

      {order.pendingDesigns.length > 0 &&
        order.status !== 'CANCELLED' &&
        order.status !== 'COMPLETED' && (
          <div className="design-pending" role="status">
            <div>
              <strong>Đơn có thiết kế riêng chưa được duyệt.</strong>
              <p>
                Hãy duyệt thiết kế trước, sau đó mới bắt đầu chuẩn bị đơn được. Nếu thiết kế cần
                chỉnh, yêu cầu khách sửa tại trang duyệt.
              </p>
            </div>
            <div className="design-pending-actions">
              {order.pendingDesigns.map((d) => (
                <Link
                  key={d.versionId}
                  className="btn btn-primary"
                  href={`/admin/designs/${d.designId}`}
                >
                  Xem &amp; duyệt thiết kế (v{d.versionNo})
                </Link>
              ))}
            </div>
          </div>
        )}

      <div className="od-grid">
        <div className="od-main">
          <section className="od-card">
            <h2>
              Sản phẩm <span className="count">{itemCount}</span>
            </h2>
            <ul className="od-items">
              {order.items.map((i) => (
                <li key={i.sku}>
                  <div className="od-item">
                    <div className="od-thumb">
                      {i.imageUrl && <img src={i.imageUrl} alt="" width={64} height={64} />}
                    </div>
                    <div className="od-item-info">
                      <strong>{i.productName}</strong>
                      <small>
                        {i.variantName !== 'Tiêu chuẩn' && <>{i.variantName} · </>}
                        SKU {i.sku}
                      </small>
                    </div>
                    <div className="od-item-qty">
                      {formatVnd(i.unitPriceVnd)} × {i.quantity}
                    </div>
                    <div className="od-item-total">{formatVnd(i.lineTotalVnd)}</div>
                  </div>
                  {i.customization && <CustomizationNote c={i.customization} staff />}
                </li>
              ))}
            </ul>
            <dl className="od-totals">
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
            </dl>
          </section>

          <section className="od-card">
            <h2>
              Lịch sử trạng thái <small>chỉ thêm, không sửa</small>
            </h2>
            <ol className="od-timeline">
              {[...order.history].reverse().map((h, i) => (
                <li key={i}>
                  <span className={`tl-dot st-${i === 0 ? 'blue' : 'muted'}`} aria-hidden="true" />
                  <div>
                    <p>
                      {h.from && <span className="from">{ORDER_STATUS_LABELS[h.from]} → </span>}
                      <StatusBadge status={h.status} />
                    </p>
                    <small>
                      {when(h.at)} ·{' '}
                      {h.actorType === 'ADMIN'
                        ? (h.actorEmail ?? 'Nhân viên')
                        : (ACTOR[h.actorType] ?? 'Khách vãng lai')}
                    </small>
                    {h.reason && <p className="reason">“{h.reason}”</p>}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <aside className="od-side">
          <section className="od-card">
            <h2>Khách hàng</h2>
            <div className="od-person">
              <span className="avatar" aria-hidden="true">
                {(a.fullName.trim()[0] ?? '?').toLocaleUpperCase('vi-VN')}
              </span>
              <div>
                <strong>{a.fullName}</strong>
                <small>{order.userId ? 'Có tài khoản' : 'Khách vãng lai'}</small>
              </div>
            </div>
            <dl className="od-kv">
              <div>
                <dt>Điện thoại</dt>
                <dd>
                  <a href={`tel:${a.phone}`}>{a.phone}</a>
                </dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>
                  <a href={`mailto:${order.customerEmail}`}>{order.customerEmail}</a>
                </dd>
              </div>
            </dl>
          </section>

          <section className="od-card">
            <h2>Giao hàng</h2>
            <address className="od-address">
              {a.line1}
              <br />
              {a.ward}, {a.district}
              <br />
              {a.province}
            </address>
            {order.customerNote && (
              <p className="od-note">
                <strong>Ghi chú của khách</strong>
                {order.customerNote}
              </p>
            )}
            {order.shipment && (
              <dl className="od-kv">
                <div>
                  <dt>Vận chuyển</dt>
                  <dd>{order.shipment.carrier}</dd>
                </div>
                {order.shipment.trackingCode && (
                  <div>
                    <dt>Mã vận đơn</dt>
                    <dd>{order.shipment.trackingCode}</dd>
                  </div>
                )}
                <div>
                  <dt>Trạng thái</dt>
                  <dd>{order.shipment.status}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="od-card">
            <h2>Thanh toán</h2>
            <dl className="od-kv">
              <div>
                <dt>Phương thức</dt>
                <dd>{order.paymentMethod === 'VNPAY' ? 'VNPay' : 'Khi nhận hàng (COD)'}</dd>
              </div>
              <div>
                <dt>Tình trạng</dt>
                <dd>
                  <span
                    className={`st-badge st-${order.paymentStatus === 'PAID' ? 'green' : order.paymentStatus === 'PENDING' ? 'amber' : 'muted'}`}
                  >
                    {PAYMENT_TEXT[order.paymentStatus] ?? order.paymentStatus}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Số tiền</dt>
                <dd>{formatVnd(order.totalVnd)}</dd>
              </div>
              {order.refundedVnd > 0 && (
                <div>
                  <dt>Đã hoàn</dt>
                  <dd>{formatVnd(order.refundedVnd)}</dd>
                </div>
              )}
            </dl>
          </section>

          <RefundPanel order={order} onChange={setOrder} />
        </aside>
      </div>
    </div>
  );
}
