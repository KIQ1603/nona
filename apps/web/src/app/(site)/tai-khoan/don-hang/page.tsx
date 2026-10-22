import { formatVnd, ORDER_STATUS_LABELS, orderListSchema } from '@nona/contracts';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { userGet } from '@/lib/session-server';

const group = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');

export default async function MyOrdersPage() {
  const list = await userGet('/me/orders?pageSize=50', orderListSchema, '/tai-khoan/don-hang');
  return (
    <>
      <h1>Đơn hàng của tôi</h1>
      <p className="lead">{list.meta.total} đơn hàng.</p>
      {list.items.length === 0 ? (
        <EmptyState title="Bạn chưa có đơn hàng nào">
          <p>Các đơn hàng của bạn sẽ hiển thị ở đây.</p>
          <Link className="btn btn-dark" href="/shop">
            Khám phá cửa hàng
          </Link>
        </EmptyState>
      ) : (
        <ul className="order-list">
          {list.items.map((o) => (
            <li key={o.code}>
              <Link href={`/don-hang/${o.code}`}>
                <span>
                  <strong>{group(o.code)}</strong>
                  <small>
                    {new Date(o.placedAt).toLocaleDateString('vi-VN')} · {o.itemCount} sản phẩm
                  </small>
                </span>
                <span className="status-chip">{ORDER_STATUS_LABELS[o.status]}</span>
                <span className="total">{formatVnd(o.totalVnd)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
