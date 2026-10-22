import { adminCategoryListSchema } from '@nona/contracts';
import { CategoryManager } from '@/features/admin/category-manager';
import { adminGet } from '@/lib/admin-server';

export default async function CategoriesPage() {
  const categories = await adminGet('/admin/categories', adminCategoryListSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Danh mục</h1>
          <p>Nhóm sản phẩm hiển thị trên thanh danh mục của cửa hàng.</p>
        </div>
      </div>
      <CategoryManager initial={categories.items} />
    </>
  );
}
