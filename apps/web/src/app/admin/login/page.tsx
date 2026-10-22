import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/admin/login-form';
import { getMe } from '@/lib/admin-server';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const me = await getMe();
  if (me?.permissions.includes('admin:access')) redirect('/admin');
  return (
    <div className="admin-login">
      <LoginForm />
    </div>
  );
}
