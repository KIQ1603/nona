import { adminDesignListSchema, DESIGN_STATUSES, DESIGN_STATUS_LABELS } from '@nona/contracts';
import Link from 'next/link';
import { DesignsTable } from '@/features/admin/designs-table';
import { FilterSelect } from '@/components/admin/filter-select';
import { AdminPagination, pageSizeFrom } from '@/components/admin/pagination';
import { adminGet } from '@/lib/admin-server';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AdminDesignsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const status = one(sp.status) ?? 'ALL';
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const size = pageSizeFrom(sp.pageSize);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(size) });
  if (q) qs.set('q', q);
  if (status !== 'ALL') qs.set('status', status);
  const list = await adminGet(`/admin/designs?${qs}`, adminDesignListSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Thiết kế riêng</h1>
          <p>{list.meta.total} thiết kế · thiết kế chờ duyệt (nếu bật duyệt) luôn nằm trên cùng.</p>
        </div>
      </div>
      <form className="filters-bar" method="get" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Tên thiết kế hoặc email khách"
          aria-label="Tìm thiết kế"
        />
        <FilterSelect
          name="status"
          defaultValue={status}
          ariaLabel="Trạng thái"
          options={[
            { value: 'ALL', label: 'Mọi trạng thái' },
            ...DESIGN_STATUSES.map((s) => ({ value: s, label: DESIGN_STATUS_LABELS[s] })),
          ]}
        />
        <button className="btn btn-dark" type="submit">
          Lọc
        </button>
      </form>
      <DesignsTable key={qs.toString()} initial={list.items} />
      <AdminPagination
        basePath="/admin/designs"
        query={qs}
        page={page}
        pageSize={size}
        total={list.meta.total}
      />
    </>
  );
}
