import { adminCategoryListSchema, adminProductDetailSchema } from '@nona/contracts';
import { notFound } from 'next/navigation';
import { ProductEditor } from '@/features/admin/product-editor';
import { adminGet } from '@/lib/admin-server';
import { ApiError } from '@/lib/api-client';

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [product, categories] = await Promise.all([
    adminGet(`/admin/products/${id}`, adminProductDetailSchema).catch((e) => {
      if (e instanceof ApiError && e.status === 404) notFound();
      throw e;
    }),
    adminGet('/admin/categories', adminCategoryListSchema),
  ]);
  return <ProductEditor initial={product} categories={categories.items} />;
}
