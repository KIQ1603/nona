import { adminSettingsSchema } from '@nona/contracts';
import { LandingForm } from '@/features/admin/landing-form';
import { adminGet } from '@/lib/admin-server';

export default async function AdminLandingPage() {
  const settings = await adminGet('/admin/settings', adminSettingsSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Trang chủ (landing)</h1>
          <p>
            Nội dung, con số và hình ảnh trên trang chủ do bạn chỉnh tại đây — không cố định trong
            mã nguồn. Sản phẩm ở phần “Bộ sưu tập” lấy tự động từ các sản phẩm nổi bật. Dữ liệu mẫu
            ban đầu cần được thay bằng thông tin thật của cửa hàng.
          </p>
        </div>
      </div>
      <LandingForm initial={settings.landing} />
    </>
  );
}
