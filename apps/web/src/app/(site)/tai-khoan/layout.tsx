import type { Metadata } from 'next';
import { AccountNav } from '@/features/account/account-nav';
import { requireUser } from '@/lib/session-server';

export const metadata: Metadata = { title: 'Tài khoản', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser('/tai-khoan');
  return (
    <div className="account-page">
      <AccountNav fullName={me.fullName} email={me.email} />
      <div className="account-content">{children}</div>
    </div>
  );
}
