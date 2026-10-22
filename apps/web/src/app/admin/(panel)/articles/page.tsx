import { adminArticleListSchema, ARTICLE_STATUS_LABELS, ARTICLE_STATUSES } from '@nona/contracts';
import Link from 'next/link';
import { FilterSelect } from '@/components/admin/filter-select';
import { AdminPagination, pageSizeFrom } from '@/components/admin/pagination';
import { adminGet } from '@/lib/admin-server';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function AdminArticlesPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const status = one(sp.status);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const size = pageSizeFrom(sp.pageSize);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(size) });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  const list = await adminGet(`/admin/articles?${qs}`, adminArticleListSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Bài viết</h1>
          <p>{list.meta.total} bài viết · hiển thị ở tab “Bài viết” trên cửa hàng.</p>
        </div>
        <Link className="btn btn-primary admin-create" href="/admin/articles/new">
          + Viết bài mới
        </Link>
      </div>
      <form className="filters-bar" method="get" role="search">
        <input name="q" defaultValue={q} placeholder="Tìm theo tiêu đề" aria-label="Tìm bài viết" />
        <FilterSelect
          name="status"
          defaultValue={status ?? ''}
          ariaLabel="Trạng thái"
          options={[
            { value: '', label: 'Mọi trạng thái' },
            ...ARTICLE_STATUSES.map((s) => ({ value: s, label: ARTICLE_STATUS_LABELS[s] })),
          ]}
        />
        <button className="btn btn-dark" type="submit">
          Lọc
        </button>
      </form>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Ảnh</th>
              <th>Tiêu đề</th>
              <th>Trạng thái</th>
              <th>Người viết</th>
              <th>Cập nhật</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((a) => (
              <tr key={a.id}>
                <td>
                  {a.coverUrl && (
                    <img
                      src={a.coverUrl}
                      alt=""
                      width={64}
                      height={44}
                      style={{ objectFit: 'cover', borderRadius: 8 }}
                    />
                  )}
                </td>
                <td className="wrap">
                  <Link href={`/admin/articles/${a.id}`}>
                    <strong>{a.title}</strong>
                  </Link>
                  <br />
                  <small>/bai-viet/{a.slug}</small>
                </td>
                <td>
                  <span
                    className={`pill ${a.status === 'PUBLISHED' ? 'pill-published' : a.status === 'ARCHIVED' ? 'pill-archived' : 'pill-draft'}`}
                  >
                    {ARTICLE_STATUS_LABELS[a.status]}
                  </span>
                </td>
                <td>{a.authorName ?? '—'}</td>
                <td>
                  {new Date(a.updatedAt).toLocaleString('vi-VN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr>
                <td colSpan={5}>Chưa có bài viết nào.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination
        basePath="/admin/articles"
        query={qs}
        page={page}
        pageSize={size}
        total={list.meta.total}
      />
    </>
  );
}
