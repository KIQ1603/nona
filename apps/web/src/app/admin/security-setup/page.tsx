import { redirect } from 'next/navigation';
import { ToastProvider } from '@/components/ui/toast';
import { AdminProvider } from '@/lib/admin-client';
import { getMe } from '@/lib/admin-server';
import { SecurityPanel } from '@/features/admin/security-panel';

export const dynamic = 'force-dynamic';

/** Landing page for staff whose session is MFA-restricted: enrol here, nothing else is reachable yet. */
export default async function SecuritySetupPage() {
  const me = await getMe();
  if (!me || !me.permissions.includes('admin:access')) redirect('/admin/login');
  if (!me.mfaRestricted) redirect('/admin');
  return (
    <ToastProvider>
      <AdminProvider me={me}>
        <div className="admin-login">
          <div style={{ width: 'min(560px, 100%)' }}>
            <SecurityPanel me={me} setupMode />
          </div>
        </div>
      </AdminProvider>
    </ToastProvider>
  );
}
