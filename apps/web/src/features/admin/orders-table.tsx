'use client';

import { formatVnd, type AdminOrderDetail } from '@nona/contracts';
import Link from 'next/link';
import { useRef, useState } from 'react';
import { AnchoredMenu } from '@/components/admin/anchored-menu';
import { useToast } from '@/components/ui/toast';
import { useAdmin } from '@/lib/admin-client';
import { StatusMenu, type StatusSubject } from './order-status';

export interface OrderRow extends StatusSubject {
  code: string;
  customerEmail: string | null;
  customerName: string;
  totalVnd: number;
  itemCount: number;
  placedAt: string;
}

const group = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');
const when = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
const PAYMENT_TEXT: Record<string, string> = {
  PAID: 'Đã thu',
  PENDING: 'Chưa thu',
  FAILED: 'Thất bại',
  REFUNDED: 'Đã hoàn',
};

/** The "⋯" button at the end of a row. */
function RowMenu({ row }: { row: OrderRow }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const toast = useToast();
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className="row-more"
        aria-label={`Thao tác cho đơn ${group(row.code)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ⋯
      </button>
      <AnchoredMenu
        open={open}
        anchor={anchor}
        align="right"
        onClose={() => setOpen(false)}
        label="Thao tác"
      >
        <Link
          className="am-item"
          role="menuitem"
          href={`/admin/orders/${row.id}`}
          onClick={() => setOpen(false)}
        >
          <span aria-hidden="true">👁</span>
          <span>Xem chi tiết</span>
        </Link>
        <button
          type="button"
          role="menuitem"
          className="am-item"
          onClick={async () => {
            setOpen(false);
            await navigator.clipboard?.writeText(row.code).catch(() => undefined);
            toast(`Đã sao chép mã ${group(row.code)}`);
          }}
        >
          <span aria-hidden="true">⧉</span>
          <span>Sao chép mã đơn</span>
        </button>
      </AnchoredMenu>
    </>
  );
}

/** Orders list: change the status right in its column, and open the details from the row's "⋯". */
export function OrdersTable({ initial }: { initial: OrderRow[] }) {
  const { can } = useAdmin();
  const [rows, setRows] = useState(initial);
  const writable = can('orders:write');
  const update = (id: string) => (d: AdminOrderDetail) =>
    setRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              status: d.status,
              version: d.version,
              allowedTransitions: d.allowedTransitions,
              paymentStatus: d.paymentStatus,
              pendingDesigns: d.pendingDesigns.length,
            }
          : r,
      ),
    );

  return (
    <div className="table-wrap">
      <table className="admin-table orders-table">
        <thead>
          <tr>
            <th>Mã đơn</th>
            <th>Khách hàng</th>
            <th>Trạng thái</th>
            <th>Thanh toán</th>
            <th className="num">Số SP</th>
            <th className="num">Tổng tiền</th>
            <th>Đặt lúc</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>
                <Link href={`/admin/orders/${o.id}`} className="order-code">
                  {group(o.code)}
                </Link>
                {o.pendingDesigns > 0 && (
                  <span className="design-flag" title="Có thiết kế riêng chờ duyệt">
                    ✎ chờ duyệt thiết kế
                  </span>
                )}
              </td>
              <td className="wrap">
                {o.customerName}
                <br />
                <small>{o.customerEmail ?? 'Không có email'}</small>
              </td>
              <td>
                <StatusMenu order={o} onChanged={update(o.id)} writable={writable} />
              </td>
              <td>
                {o.paymentMethod} · {PAYMENT_TEXT[o.paymentStatus] ?? o.paymentStatus}
              </td>
              <td className="num">{o.itemCount}</td>
              <td className="num">{formatVnd(o.totalVnd)}</td>
              <td>{when(o.placedAt)}</td>
              <td className="row-actions">
                <RowMenu row={o} />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={8}>Không có đơn hàng phù hợp.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
