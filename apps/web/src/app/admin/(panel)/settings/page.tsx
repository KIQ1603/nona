import { adminSettingsSchema } from '@nona/contracts';
import { SettingsForm } from '@/features/admin/settings-form';
import { adminGet } from '@/lib/admin-server';

export default async function SettingsPage() {
  const settings = await adminGet('/admin/settings', adminSettingsSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Khuyến mãi và cấu hình</h1>
          <p>
            Mọi nội dung khuyến mãi hiển thị cho khách do bạn thiết lập tại đây — không nằm trong mã
            nguồn.
          </p>
        </div>
      </div>
      <SettingsForm initial={settings} />
    </>
  );
}
