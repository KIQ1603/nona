import { adminCategoryListSchema, adminSettingsSchema } from '@nona/contracts';
import { PageImagesForm } from '@/features/admin/page-images-form';
import { getPageImages } from '@/features/pages/pages.api';
import { adminGet } from '@/lib/admin-server';

export default async function PageImagesPage() {
  const [settings, categories, urls] = await Promise.all([
    adminGet('/admin/settings', adminSettingsSchema),
    adminGet('/admin/categories', adminCategoryListSchema),
    getPageImages(),
  ]);
  const types = categories.items
    .filter((c) => c.parentId === null)
    .map((c) => ({ slug: c.slug, name: c.name }));
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Ảnh Trang chủ và Giới thiệu</h1>
          <p>
            Đổi ảnh ở các ô của hai trang. Ô chưa chọn ảnh dùng ảnh mặc định của cửa hàng. Ảnh nên
            đủ nét (tối thiểu 300px mỗi cạnh); hệ thống tự nén và lưu lên kho ảnh.
          </p>
        </div>
      </div>
      <PageImagesForm initial={settings.pages} urls={urls} types={types} />
    </>
  );
}
