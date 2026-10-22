import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/features/account/auth-form';
import { getMe } from '@/lib/admin-server';
import { safeNext } from '@/lib/session-server';

export const metadata: Metadata = { title: 'Đăng ký', robots: { index: false } };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const next = safeNext((await searchParams).next);
  if (await getMe()) redirect(next);
  return (
    <div className="auth-page">
      <AuthForm kind="register" next={next} />
    </div>
  );
}
