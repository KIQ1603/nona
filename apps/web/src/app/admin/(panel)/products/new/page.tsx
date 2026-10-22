import { adminCategoryListSchema } from '@nona/contracts';
import { ProductCreateForm } from '@/features/admin/product-create-form';
import { adminGet } from '@/lib/admin-server';

export default async function NewProductPage() {
  const categories = await adminGet('/admin/categories', adminCategoryListSchema);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Thêm sản phẩm</h1>
          <p>Sản phẩm mới ở trạng thái nháp; thêm ảnh và biến thể rồi mới đăng bán.</p>
        </div>
      </div>
      <ProductCreateForm categories={categories.items} />
    </>
  );
}
