import { adminUserListSchema, formatVnd } from '@nona/contracts';
import { FilterSelect } from '@/components/admin/filter-select';
import { AdminPagination, pageSizeFrom } from '@/components/admin/pagination';
import { adminGet } from '@/lib/admin-server';

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const nf = new Intl.NumberFormat('vi-VN');
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Ho_Chi_Minh',
      })
    : '—';

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: 'Khách hàng',
  ADMIN: 'Quản trị',
  SUPPORT: 'Hỗ trợ',
  CATALOG: 'Sản phẩm',
  FULFILLMENT: 'Giao hàng',
  FINANCE: 'Tài chính',
};

export default async function AdminUsersPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const q = one(sp.q);
  const role = one(sp.role);
  const status = one(sp.status);
  const page = Math.max(1, Number(one(sp.page)) || 1);
  const size = pageSizeFrom(sp.pageSize);
  const qs = new URLSearchParams({ page: String(page), pageSize: String(size) });
  if (q) qs.set('q', q);
  if (role) qs.set('role', role);
  if (status) qs.set('status', status);
  const list = await adminGet(`/admin/users?${qs}`, adminUserListSchema);
  const s = list.summary;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tài khoản</h1>
          <p>Danh sách người dùng đã đăng ký — mật khẩu không bao giờ được hiển thị.</p>
        </div>
      </div>

      <div className="admin-grid">
        <div className="stat">
          <strong>{nf.format(s.total)}</strong>
          <span>Tổng tài khoản</span>
        </div>
        <div className="stat">
          <strong>{nf.format(s.customers)}</strong>
          <span>Khách hàng</span>
        </div>
        <div className="stat">
          <strong>{nf.format(s.newThisMonth)}</strong>
          <span>Đăng ký trong tháng</span>
        </div>
        <div className="stat">
          <strong>{nf.format(s.activeLast30Days)}</strong>
          <span>Đăng nhập 30 ngày qua</span>
        </div>
        <div className="stat">
          <strong>{nf.format(s.staff)}</strong>
          <span>Nhân viên</span>
        </div>
        <div className="stat">
          <strong>{nf.format(s.disabled)}</strong>
          <span>Bị khóa</span>
        </div>
      </div>

      <form className="filters-bar" method="get" role="search">
        <input
          name="q"
          defaultValue={q}
          placeholder="Tên, email hoặc số điện thoại"
          aria-label="Tìm tài khoản"
        />
        <FilterSelect
          name="role"
          defaultValue={role ?? ''}
          ariaLabel="Loại tài khoản"
          options={[
            { value: '', label: 'Mọi loại' },
            { value: 'CUSTOMER', label: 'Khách hàng' },
            { value: 'STAFF', label: 'Nhân viên' },
          ]}
        />
        <FilterSelect
          name="status"
          defaultValue={status ?? ''}
          ariaLabel="Trạng thái"
          options={[
            { value: '', label: 'Mọi trạng thái' },
            { value: 'ACTIVE', label: 'Đang hoạt động' },
            { value: 'DISABLED', label: 'Bị khóa' },
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
              <th>Tài khoản</th>
              <th>Liên hệ</th>
              <th>Loại</th>
              <th>Đăng ký</th>
              <th>Đăng nhập gần nhất</th>
              <th className="num">Đơn</th>
              <th className="num">Đã mua</th>
              <th className="num">Yêu thích</th>
              <th className="num">Thiết kế</th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.fullName}</strong>
                  {u.status === 'DISABLED' && <span className="delta down"> · bị khóa</span>}
                  {u.google && <small style={{ display: 'block' }}>Đăng nhập Google</small>}
                </td>
                <td>
                  {u.email ?? '—'}
                  {u.email && !u.emailVerified && (
                    <small style={{ display: 'block' }}>chưa xác minh email</small>
                  )}
                  {u.phone && (
                    <small style={{ display: 'block' }}>
                      {u.phone}
                      {u.phoneVerified ? '' : ' (chưa xác minh)'}
                    </small>
                  )}
                </td>
                <td>{ROLE_LABEL[u.role] ?? u.role}</td>
                <td>{when(u.createdAt)}</td>
                <td>{when(u.lastLoginAt)}</td>
                <td className="num">{u.orders}</td>
                <td className="num">{u.spentVnd ? formatVnd(u.spentVnd) : '—'}</td>
                <td className="num">{u.wishlist}</td>
                <td className="num">{u.designs}</td>
              </tr>
            ))}
            {list.items.length === 0 && (
              <tr>
                <td colSpan={9}>Không có tài khoản phù hợp.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <AdminPagination
        basePath="/admin/users"
        query={qs}
        page={page}
        pageSize={size}
        total={list.meta.total}
      />
    </>
  );
}
