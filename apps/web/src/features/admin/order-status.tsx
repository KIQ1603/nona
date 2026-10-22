'use client';

import { ORDER_STATUS_LABELS, type AdminOrderDetail, type OrderStatus } from '@nona/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAction } from '@/components/admin/use-action';
import { AnchoredMenu } from '@/components/admin/anchored-menu';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';

export const STATUS_TONE: Record<OrderStatus, string> = {
  DRAFT: 'muted',
  PENDING_PAYMENT: 'amber',
  PAYMENT_FAILED: 'red',
  EXPIRED: 'red',
  PAID: 'blue',
  CONFIRMED: 'sand',
  PROCESSING: 'blue',
  READY_TO_SHIP: 'teal',
  SHIPPING: 'purple',
  COMPLETED: 'green',
  CANCELLATION_REQUESTED: 'amber',
  CANCELLED: 'red',
  REFUND_PENDING: 'orange',
  PARTIALLY_REFUNDED: 'orange',
  REFUNDED: 'muted',
};

/** Verb-style labels for the next step (what the staff member does). */
export const ACTION_LABEL: Partial<Record<OrderStatus, string>> = {
  PROCESSING: 'Bắt đầu chuẩn bị',
  READY_TO_SHIP: 'Sẵn sàng giao',
  SHIPPING: 'Giao cho vận chuyển',
  COMPLETED: 'Đã giao & thu tiền',
  CANCELLED: 'Hủy đơn',
};

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`st-badge st-${STATUS_TONE[status]}`}>{ORDER_STATUS_LABELS[status]}</span>
  );
}

/** The slice of an order the status controls need (the list rows and the detail page both provide it). */
export interface StatusSubject {
  id: string;
  version: number;
  status: OrderStatus;
  allowedTransitions: OrderStatus[];
  pendingDesigns: number;
  paymentMethod: string;
  paymentStatus: string;
}

/** Why a step cannot be taken right now (null = it can). */
export const blockedReason = (o: StatusSubject, to: OrderStatus) =>
  to === 'PROCESSING' && o.pendingDesigns > 0 ? 'Cần duyệt thiết kế của đơn này trước' : null;

/**
 * Moves an order to another status. Steps that need extra input (carrier, cancellation reason) ask for it
 * in a small dialog. Returns the fresh order through `onChanged`.
 */
export function useStatusChange(order: StatusSubject, onChanged: (o: AdminOrderDetail) => void) {
  const { request } = useAdmin();
  const toast = useToast();
  const { pending, error, run, clearError } = useAction();
  const [dialog, setDialog] = useState<OrderStatus | null>(null);
  const [reason, setReason] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');

  const apply = async (to: OrderStatus) => {
    const res = await run(() =>
      request<AdminOrderDetail>('PATCH', `/admin/orders/${order.id}/status`, {
        to,
        version: order.version,
        ...(to === 'CANCELLED' && reason.trim() ? { reason: reason.trim() } : {}),
        ...(to === 'SHIPPING'
          ? {
              shipment: {
                carrier: carrier.trim(),
                ...(tracking.trim() ? { trackingCode: tracking.trim() } : {}),
              },
            }
          : {}),
      }),
    );
    if (res) {
      onChanged(res);
      setDialog(null);
      setReason('');
      toast(`Đã chuyển sang “${ORDER_STATUS_LABELS[to]}”`);
    }
    return res;
  };
  const start = (to: OrderStatus) => {
    clearError();
    if (to === 'SHIPPING' || to === 'CANCELLED') setDialog(to);
    else void apply(to);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (dialog) void apply(dialog);
  };

  const dialogNode =
    dialog &&
    createPortal(
      <div className="admin-root admin-portal">
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(e) => e.target === e.currentTarget && setDialog(null)}
        >
          <form
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-dialog"
            onSubmit={submit}
            onKeyDown={(e) => e.key === 'Escape' && setDialog(null)}
          >
            <h3 id="order-dialog">
              {dialog === 'SHIPPING'
                ? 'Giao cho đơn vị vận chuyển'
                : order.paymentMethod === 'VNPAY' && order.paymentStatus === 'PAID'
                  ? 'Hủy đơn & hoàn tiền'
                  : 'Hủy đơn hàng'}
            </h3>
            {dialog === 'SHIPPING' ? (
              <>
                <label className="field">
                  <span>Đơn vị vận chuyển *</span>
                  <input
                    required
                    autoFocus
                    maxLength={80}
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    placeholder="VD: GHN, GHTK, Viettel Post"
                  />
                </label>
                <label className="field">
                  <span>Mã vận đơn</span>
                  <input
                    maxLength={80}
                    value={tracking}
                    onChange={(e) => setTracking(e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <p>Tồn kho của đơn sẽ được hoàn lại và khách nhận email thông báo.</p>
                <label className="field">
                  <span>Lý do hủy *</span>
                  <input
                    required
                    autoFocus
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
              </>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                className={`btn ${dialog === 'CANCELLED' ? 'btn-danger' : 'btn-primary'}`}
                type="submit"
                disabled={pending}
              >
                Xác nhận
              </button>
              <button className="btn btn-outline" type="button" onClick={() => setDialog(null)}>
                Đóng
              </button>
            </div>
          </form>
        </div>
      </div>,
      document.body,
    );

  return { start, pending, error: dialog ? null : error, dialogNode };
}

/** The status itself is the control: click it to see what the order can move to. */
export function StatusMenu({
  order,
  onChanged,
  writable,
}: {
  order: StatusSubject;
  onChanged: (o: AdminOrderDetail) => void;
  writable: boolean;
}) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const change = useStatusChange(order, onChanged);
  const steps = order.allowedTransitions;
  const interactive = writable && steps.length > 0;

  if (!interactive) return <StatusBadge status={order.status} />;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`st-badge st-${STATUS_TONE[order.status]} st-trigger`}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Đổi trạng thái"
        disabled={change.pending}
        onClick={() => setOpen(!open)}
      >
        {ORDER_STATUS_LABELS[order.status]}
        <span className="st-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label="Chuyển trạng thái"
      >
        <div className="am-title">Chuyển sang</div>
        {steps.map((to) => {
          const why = blockedReason(order, to);
          return (
            <button
              key={to}
              type="button"
              role="menuitem"
              className={`am-item${to === 'CANCELLED' ? ' danger' : ''}`}
              disabled={Boolean(why)}
              onClick={() => {
                setOpen(false);
                change.start(to);
              }}
            >
              <span className={`st-dot st-${STATUS_TONE[to]}`} aria-hidden="true" />
              <span>
                {ACTION_LABEL[to] ?? ORDER_STATUS_LABELS[to]}
                {why && <small>{why}</small>}
              </span>
            </button>
          );
        })}
      </AnchoredMenu>
      {change.dialogNode}
      {change.error && (
        <span className="st-error" role="alert">
          {change.error}
        </span>
      )}
    </>
  );
}
