'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { Permission } from '@nona/contracts';
import { useAdmin } from '@/lib/admin-client';

const NAV: { href: string; label: string; permission?: Permission }[] = [
  { href: '/admin', label: 'Tổng quan' },
  { href: '/admin/orders', label: 'Đơn hàng', permission: 'orders:read' },
  { href: '/admin/designs', label: 'Thiết kế riêng', permission: 'designs:read' },
  { href: '/admin/custom-options', label: 'Tùy chọn NONA Custom', permission: 'settings:write' },
  { href: '/admin/products', label: 'Sản phẩm' },
  { href: '/admin/categories', label: 'Danh mục' },
  { href: '/admin/coupons', label: 'Mã giảm giá' },
  { href: '/admin/articles', label: 'Bài viết', permission: 'articles:write' },
  { href: '/admin/landing', label: 'Trang chủ (landing)', permission: 'settings:write' },
  { href: '/admin/contact', label: 'Liên hệ và kênh chat', permission: 'settings:write' },
  { href: '/admin/settings', label: 'Khuyến mãi và cấu hình', permission: 'settings:write' },
  { href: '/admin/system', label: 'Hệ thống', permission: 'system:read' },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { me, can, request } = useAdmin();

  const logout = async () => {
    await request('POST', '/auth/logout').catch(() => undefined);
    router.replace('/admin/login');
    router.refresh();
  };

  return (
    <div className="admin-layout">
      <a className="skip-link" href="#admin-main">
        Bỏ qua điều hướng
      </a>
      <aside className="admin-sidebar">
        <Link href="/admin" className="admin-brand">
          <span className="brand-mark" aria-hidden="true">
            N
          </span>{' '}
          NONA <small>Admin</small>
        </Link>
        <nav aria-label="Quản trị">
          {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => {
            const active =
              n.href === '/admin' ? pathname === '/admin' : pathname.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="admin-user">
          <strong>{me.fullName}</strong>
          <span>{me.role}</span>
          <Link href="/" target="_blank">
            Xem cửa hàng ↗
          </Link>
          <button type="button" className="admin-link-button" onClick={logout}>
            Đăng xuất
          </button>
        </div>
      </aside>
      <main id="admin-main" className="admin-main">
        {children}
      </main>
    </div>
  );
}
