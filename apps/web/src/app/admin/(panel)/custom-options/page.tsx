import { adminSettingsSchema } from '@nona/contracts';
import { CustomOptionsForm } from '@/features/admin/custom-options-form';
import { adminGet } from '@/lib/admin-server';

export default async function CustomOptionsPage() {
  const settings = await adminGet('/admin/settings', adminSettingsSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Tùy chọn NONA Custom</h1>
          <p>
            Khách xem nón và trang trí bằng các charm của cửa hàng. Mỗi charm có mã, tên, hình, kích
            thước và giá; đơn hàng ghi lại mã và tên charm để không bị nhầm.
          </p>
        </div>
      </div>
      <CustomOptionsForm initial={settings.custom} />
    </>
  );
}
