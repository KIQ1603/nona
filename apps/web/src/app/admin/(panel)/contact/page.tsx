import { adminSettingsSchema } from '@nona/contracts';
import { ContactForm } from '@/features/admin/contact-form';
import { adminGet } from '@/lib/admin-server';

export default async function AdminContactPage() {
  const settings = await adminGet('/admin/settings', adminSettingsSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Liên hệ và kênh chat</h1>
          <p>
            Zalo, Facebook, Gmail, TikTok… hiển thị thành nút nhấp nháy bên phải cửa hàng, ở chân
            trang và trong trang Liên hệ. Mọi liên kết do bạn thiết lập tại đây.
          </p>
        </div>
      </div>
      <ContactForm initial={settings.contact} />
    </>
  );
}
