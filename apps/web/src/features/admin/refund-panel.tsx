'use client';

import { formatVnd, type AdminOrderDetail } from '@nona/contracts';
import { useState, type FormEvent } from 'react';
import { useAction } from '@/components/admin/use-action';
import { useToast } from '@/components/ui/toast';
import { newIdempotencyKey, useAdmin } from '@/lib/admin-client';

const REFUNDABLE_STATES = ['COMPLETED', 'PARTIALLY_REFUNDED', 'REFUND_PENDING'];
const STATUS_TEXT = {
  PENDING: 'Chờ xác nhận',
  SUCCEEDED: 'Thành công',
  FAILED: 'Thất bại',
} as const;

/** Refunds on the online payment: history, manual/partial refund, and resolving ones the provider could not confirm. */
export function RefundPanel({
  order,
  onChange,
}: {
  order: AdminOrderDetail;
  onChange: (o: AdminOrderDetail) => void;
}) {
  const { request, can } = useAdmin();
  const toast = useToast();
  const { pending, error, run } = useAction();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  // One key per form instance: a double click or network retry cannot create two refunds.
  const [key, setKey] = useState(newIdempotencyKey);
  const writable = can('refunds:write');
  const canRequest =
    writable && order.refundableVnd > 0 && REFUNDABLE_STATES.includes(order.status);

  if (order.paymentMethod !== 'VNPAY' && order.refunds.length === 0) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await run(() =>
      request<AdminOrderDetail>(
        'POST',
        `/admin/orders/${order.id}/refunds`,
        { amountVnd: Math.floor(Number(amount)), reason: reason.trim() },
        { idempotencyKey: key },
      ),
    );
    if (res) {
      onChange(res);
      setAmount('');
      setReason('');
      setKey(newIdempotencyKey());
      toast('Đã gửi yêu cầu hoàn tiền');
    }
  };
  const resolve = async (id: string, outcome: 'SUCCEEDED' | 'FAILED') => {
    const note = window.prompt(
      outcome === 'SUCCEEDED'
        ? 'Ghi chú đối chiếu (đã hoàn tiền trên cổng VNPay):'
        : 'Lý do đánh dấu thất bại:',
    );
    if (!note?.trim()) return;
    const res = await run(() =>
      request<AdminOrderDetail>('POST', `/admin/refunds/${id}/resolve`, {
        outcome,
        note: note.trim(),
      }),
    );
    if (res) {
      onChange(res);
      toast('Đã cập nhật yêu cầu hoàn tiền');
    }
  };

  return (
    <section className="admin-card" aria-labelledby="refund-title">
      <h2 id="refund-title">
        Hoàn tiền{' '}
        <small>
          còn có thể hoàn: {formatVnd(order.refundableVnd)} · đã hoàn:{' '}
          {formatVnd(order.refundedVnd)}
        </small>
      </h2>
      {order.refunds.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th className="num">Số tiền</th>
                <th>Trạng thái</th>
                <th>Lý do</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {order.refunds.map((r) => (
                <tr key={r.id}>
                  <td>
                    {new Date(r.createdAt).toLocaleString('vi-VN', {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}
                  </td>
                  <td className="num">{formatVnd(r.amountVnd)}</td>
                  <td>
                    <span
                      className={`pill ${r.status === 'SUCCEEDED' ? 'pill-published' : r.status === 'FAILED' ? 'pill-out' : 'pill-low'}`}
                    >
                      {STATUS_TEXT[r.status]}
                    </span>
                    {r.failureReason && (
                      <>
                        <br />
                        <small>{r.failureReason}</small>
                      </>
                    )}
                  </td>
                  <td className="wrap">{r.reason}</td>
                  <td>
                    {r.status === 'PENDING' && writable && (
                      <div className="row-inline">
                        <button
                          className="btn btn-outline btn-sm"
                          type="button"
                          disabled={pending}
                          onClick={() => resolve(r.id, 'SUCCEEDED')}
                        >
                          Đã hoàn (đối chiếu)
                        </button>
                        <button
                          className="btn btn-outline btn-sm"
                          type="button"
                          disabled={pending}
                          onClick={() => resolve(r.id, 'FAILED')}
                        >
                          Đánh dấu thất bại
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {order.refunds.some((r) => r.status === 'PENDING') && (
        <p className="form-note" style={{ marginTop: 12 }}>
          Yêu cầu đang “Chờ xác nhận” chưa rõ kết quả từ VNPay. Hệ thống{' '}
          <strong>không tự gửi lại</strong> để tránh hoàn tiền hai lần — hãy đối chiếu trên cổng
          VNPay rồi xác nhận thủ công.
        </p>
      )}
      {canRequest && (
        <form onSubmit={submit} style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 16, margin: '0 0 10px' }}>Tạo yêu cầu hoàn tiền</h3>
          <div className="form-row">
            <label className="field">
              <span>Số tiền (VNĐ) *</span>
              <input
                type="number"
                min={1}
                max={order.refundableVnd}
                step={1}
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <small>Tối đa {formatVnd(order.refundableVnd)}.</small>
            </label>
            <label className="field">
              <span>Lý do *</span>
              <input
                required
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="VD: Khách trả 1 sản phẩm"
              />
            </label>
          </div>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary" type="submit" disabled={pending}>
            Gửi yêu cầu hoàn tiền
          </button>
        </form>
      )}
      {!canRequest && error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
