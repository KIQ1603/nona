import type { Metadata } from 'next';
import Link from 'next/link';
import { getCategories, getProducts } from '@/features/catalog/api/catalog.api';
import { FeaturedRow } from '@/features/catalog/components/type-page';
import { DesignEditor } from '@/features/custom/design-editor';
import { getCustomCatalog } from '@/features/custom/custom.api';
import { MyDesigns } from '@/features/custom/my-designs';

export const metadata: Metadata = {
  title: 'Tự thiết kế sản phẩm',
  description: 'Sắc Chằm Custom: tự thiết kế nón lá, móc khóa, kẹp tóc độc bản của riêng bạn.',
};

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function CustomDesignPage({ searchParams }: { searchParams: Search }) {
  const sp = await searchParams;
  const catalog = await getCustomCatalog().catch(() => null);
  if (!catalog || !catalog.options.enabled || catalog.products.length === 0)
    return (
      <div className="page-simple">
        <p className="eyebrow">Sắc Chằm Custom</p>
        <h1>Tạm thời chưa mở</h1>
        <p>
          Dịch vụ thiết kế nón riêng hiện chưa sẵn sàng. Trong lúc chờ đợi, hãy khám phá bộ sưu tập
          hiện có.
        </p>
        <Link className="btn btn-dark" href="/shop">
          Xem bộ sưu tập
        </Link>
      </div>
    );
  const [featuredRes, firstRes, categories] = await Promise.all([
    getProducts({ featured: 'true', sort: 'featured', pageSize: 3 }).catch(() => null),
    getProducts({ sort: 'featured', pageSize: 3 }).catch(() => null),
    getCategories().catch(() => null),
  ]);
  const allTypes = (categories?.items ?? [])
    .filter((c) => c.parentSlug === null)
    .map((c) => ({ slug: c.slug, name: c.name }));
  // nothing flagged as featured yet: show the first products instead of an empty block
  const featured = featuredRes?.items.length ? featuredRes.items : (firstRes?.items ?? []);
  return (
    <div className="custom-wrap">
      <DesignEditor
        catalog={catalog}
        allTypes={allTypes}
        preselect={{ slug: one(sp.sanpham), variantId: one(sp.v) }}
      />
      <FeaturedRow products={featured} />
      <MyDesigns heading="Thiết kế gần đây của bạn" />
    </div>
  );
}
