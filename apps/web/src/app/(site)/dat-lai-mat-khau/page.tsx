import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetForm } from '@/features/account/reset-form';

export const metadata: Metadata = {
  title: 'Đặt lại mật khẩu',
  robots: { index: false },
  referrer: 'no-referrer',
};

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const token = (await searchParams).token;
  return (
    <div className="auth-page">
      {token ? (
        <ResetForm token={token} />
      ) : (
        <div className="auth-card">
          <h1>Liên kết không hợp lệ</h1>
          <p className="lead">
            Hãy <Link href="/quen-mat-khau">yêu cầu liên kết mới</Link>.
          </p>
        </div>
      )}
    </div>
  );
}
