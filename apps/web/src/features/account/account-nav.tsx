'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCustomer } from '@/lib/customer-client';

const LINKS = [
  { href: '/tai-khoan', label: 'Hồ sơ' },
  { href: '/tai-khoan/don-hang', label: 'Đơn hàng' },
  { href: '/tai-khoan/thiet-ke', label: 'Thiết kế của tôi' },
  { href: '/tai-khoan/dia-chi', label: 'Địa chỉ' },
  { href: '/tai-khoan/yeu-thich', label: 'Yêu thích' },
  { href: '/tai-khoan/mat-khau', label: 'Đổi mật khẩu' },
];

export function AccountNav({ fullName, email }: { fullName: string; email: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useCustomer();
  return (
    <nav className="account-nav" aria-label="Tài khoản">
      <div className="who">
        <strong>{fullName}</strong>
        <span>{email ?? 'Đăng ký bằng số điện thoại'}</span>
      </div>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} aria-current={pathname === l.href ? 'page' : undefined}>
          {l.label}
        </Link>
      ))}
      <button
        type="button"
        onClick={async () => {
          await signOut();
          router.replace('/');
          router.refresh();
        }}
      >
        Đăng xuất
      </button>
    </nav>
  );
}
