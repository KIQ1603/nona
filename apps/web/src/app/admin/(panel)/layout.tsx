import { AdminShell } from '@/components/admin/admin-shell';
import { ToastProvider } from '@/components/ui/toast';
import { AdminProvider } from '@/lib/admin-client';
import { requireStaff } from '@/lib/admin-server';

export const dynamic = 'force-dynamic';

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const me = await requireStaff();
  return (
    <ToastProvider>
      <AdminProvider me={me}>
        <AdminShell>{children}</AdminShell>
      </AdminProvider>
    </ToastProvider>
  );
}
