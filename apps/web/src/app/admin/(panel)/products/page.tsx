import {
  adminCategoryListSchema,
  adminProductListResponseSchema,
  formatVnd,
} from '@nona/contracts';
import Link from 'next/link';
import { ProductStockCell } from '@/features/admin/product-stock';
import { ProductRowMenu, ProductStatusCell } from '@/features/admin/product-row';
import { FilterSelect } from '@/components/admin/filter-select';
import { AdminPagination, pageSizeFrom } from '@/components/admin/pagination';
import { adminGet, requireStaff } from '@/lib/admin-server';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;

export default async function ProductsPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const me = await requireStaff();
  const writable = me.permissions.includes('catalog:write');
  const canStock = me.permissions.includes('inventory:write');
  const q = one(sp.q);
  const status = one(sp.status);
  const categoryId = one(sp.categoryId);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const size = pageSizeFrom(sp.pageSize);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(size) });
  if (q) qs.set('q', q);
  if (status) qs.set('status', status);
  if (categoryId) qs.set('categoryId', categoryId);
  const [list, categories] = await Promise.all([
    adminGet(`/admin/products?${qs}`, adminProductListResponseSchema),
    adminGet('/admin/categories', adminCategoryListSchema),
  ]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Sản phẩm</h1>
          <p>{list.meta.total} sản phẩm</p>
        </div>
        <Link className="btn btn-primary admin-create" href="/admin/products/new">
          + Thêm sản phẩm
        </Link>
      </div>
      <form className="filters-bar" method="get" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Tìm theo tên, slug hoặc SKU"
          aria-label="Tìm sản phẩm"
        />
        <FilterSelect
          name="status"
          defaultValue={status ?? ''}
          ariaLabel="Trạng thái"
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'PUBLISHED', label: 'Đang bán' },
            { value: 'DRAFT', label: 'Nháp' },
            { value: 'ARCHIVED', label: 'Lưu trữ' },
          ]}
        />
        <FilterSelect
          name="categoryId"
          defaultValue={categoryId ?? ''}
          ariaLabel="Danh mục"
          options={[
            { value: '', label: 'Mọi danh mục' },
            ...categories.items.map((c) => ({ value: c.id, label: c.name })),
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
              <th>Sản phẩm</th>
              <th>Trạng thái</th>
              <th>Danh mục</th>
              <th className="num">Giá từ</th>
              <th className="num">Tồn kho</th>
              <th>Màu / size</th>
              <th>Ảnh</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.items.map((p) => (
              <tr key={p.id}>
                <td className="wrap">
                  <Link className="row-inline" href={`/admin/products/${p.id}`}>
                    {p.thumbnailUrl ? (
                      <img className="thumb" src={p.thumbnailUrl} alt="" width={46} height={46} />
                    ) : (
                      <span className="thumb" aria-hidden="true" />
                    )}
                    <span>
                      <strong>{p.name}</strong>
                      <br />
                      <small>{p.slug}</small>
                    </span>
                  </Link>
                </td>
                <td>
                  <ProductStatusCell id={p.id} status={p.status} writable={writable} />
                </td>
                <td>{p.category.name}</td>
                <td className="num">{p.priceFromVnd === null ? '—' : formatVnd(p.priceFromVnd)}</td>
                <td className="num">
                  <ProductStockCell id={p.id} total={p.totalStock} writable={canStock} />
                </td>
                <td>{p.variantCount}</td>
                <td>{p.imageCount}</td>
                <td className="row-actions">
                  <ProductRowMenu
                    id={p.id}
                    slug={p.slug}
                    name={p.name}
                    status={p.status}
                    writable={writable}
                  />
                </td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr>
                <td colSpan={8}>Không có sản phẩm phù hợp.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination
        basePath="/admin/products"
        query={qs}
        page={page}
        pageSize={size}
        total={list.meta.total}
      />
    </>
  );
}
