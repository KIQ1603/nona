import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { getCategories, getProducts } from '@/features/catalog/api/catalog.api';
import { NonLaCard } from '@/features/catalog/components/nonla-card';
import {
  parseShopParams,
  shopHref,
  type RawSearchParams,
} from '@/features/catalog/lib/shop-params';
import { CustomCta } from '@/features/custom/custom-cta';

export const metadata: Metadata = {
  title: 'Sản phẩm',
  description:
    'Khám phá sản phẩm thủ công Sắc Chằm: nón lá, móc khóa, kẹp tóc mang đậm bản sắc Việt.',
  alternates: { canonical: '/shop' },
};

/**
 * `/shop` sends shoppers to the first product type (Nón lá…). With `?q=` or `?category=` it is the search /
 * category result page: one grid with every match.
 */
export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = parseShopParams(await searchParams);
  const categories = await getCategories();
  const types = categories.items.filter((c) => c.parentSlug === null);
  if (!params.q && !params.category && types[0]) redirect(`/shop/${types[0].slug}`);

  const result = await getProducts({
    category: params.category,
    q: params.q,
    sort: params.sort,
    pageSize: 48,
  });
  const current = categories.items.find((c) => c.slug === params.category);
  const title = params.q ? `Kết quả cho “${params.q}”` : (current?.name ?? 'Sản phẩm');

  return (
    <>
      <div className="nl">
        <h1 className="nl-title">{title}</h1>
        {result.items.length > 0 ? (
          <div className="nl-grid">
            {result.items.map((product) => (
              <NonLaCard key={product.id} product={product} />
            ))}
          </div>
        ) : (
          <EmptyState title="Chưa tìm thấy sản phẩm phù hợp">
            <p>Thử đổi từ khóa hoặc danh mục nhé.</p>
            <Link className="btn btn-dark" href={shopHref({})}>
              Xem tất cả
            </Link>
          </EmptyState>
        )}
      </div>
      <CustomCta />
    </>
  );
}
