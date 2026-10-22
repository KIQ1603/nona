import {
  adminOrderListSchema,
  formatVnd,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
} from '@nona/contracts';
import Link from 'next/link';
import { OrdersTable } from '@/features/admin/orders-table';
import { FilterSelect } from '@/components/admin/filter-select';
import { AdminPagination, pageSizeFrom } from '@/components/admin/pagination';
import { adminGet } from '@/lib/admin-server';

const group = (code: string) => code.replace(/(.{4})(?=.)/g, '$1-');
type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AdminOrdersPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const status = one(sp.status);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const size = pageSizeFrom(sp.pageSize);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(size) });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const list = await adminGet(`/admin/orders?${qs}`, adminOrderListSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Đơn hàng</h1>
          <p>{list.meta.total} đơn hàng</p>
        </div>
      </div>
      <form className="filters-bar" method="get" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Mã đơn, email, SĐT hoặc tên"
          aria-label="Tìm đơn hàng"
        />
        <FilterSelect
          name="status"
          defaultValue={status ?? ''}
          ariaLabel="Trạng thái"
          options={[
            { value: '', label: 'Mọi trạng thái' },
            ...ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] })),
          ]}
        />
        <button className="btn btn-dark" type="submit">
          Lọc
        </button>
      </form>
      <OrdersTable key={qs.toString()} initial={list.items} />
      <AdminPagination
        basePath="/admin/orders"
        query={qs}
        page={page}
        pageSize={size}
        total={list.meta.total}
      />
    </>
  );
}
