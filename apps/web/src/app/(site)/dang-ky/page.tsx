import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GOOGLE_ERRORS } from '@/lib/auth-providers';
import { RegisterForm } from '@/features/account/register-form';
import { getMe } from '@/lib/admin-server';
import { safeNext } from '@/lib/session-server';

export const metadata: Metadata = { title: 'Đăng ký', robots: { index: false } };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; loi?: string }>;
}) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  if (await getMe()) redirect(next);
  return (
    <div className="auth-page">
      <RegisterForm next={next} google notice={sp.loi ? GOOGLE_ERRORS[sp.loi] : undefined} />
    </div>
  );
}
