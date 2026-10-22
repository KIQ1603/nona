import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui/empty-state';
import { getCategories, getProducts } from '@/features/catalog/api/catalog.api';
import { CategoryStrip } from '@/features/catalog/components/category-strip';
import { FilterPanel } from '@/features/catalog/components/filter-panel';
import { FiltersProvider } from '@/features/catalog/components/filters-context';
import { Pagination } from '@/features/catalog/components/pagination';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { ShopHero } from '@/features/catalog/components/shop-hero';
import { Toolbar } from '@/features/catalog/components/toolbar';
import {
  parseShopParams,
  SHOP_PAGE_SIZE,
  shopHref,
  type RawSearchParams,
} from '@/features/catalog/lib/shop-params';
import { CustomCta } from '@/features/custom/custom-cta';

export const metadata: Metadata = {
  title: 'Shop nón lá',
  description:
    'Khám phá nón lá thủ công NONA: nón truyền thống, nón họa, nón thời trang và quà tặng mini.',
  alternates: { canonical: '/shop' },
};

export default async function ShopPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = parseShopParams(await searchParams);
  const [categories, result] = await Promise.all([
    getCategories(),
    getProducts({ ...params, pageSize: SHOP_PAGE_SIZE }),
  ]);
  const filtered = Boolean(
    params.category ||
    params.q ||
    params.maxPriceVnd !== undefined ||
    params.colors.length ||
    params.styles.length,
  );

  return (
    <>
      <ShopHero />
      <CategoryStrip categories={categories.items} params={params} />
      <FiltersProvider>
        <div className="shop-layout">
          <FilterPanel
            params={params}
            priceMinVnd={result.facets.priceMinVnd}
            priceMaxVnd={result.facets.priceMaxVnd}
          />
          <section className="products-area" aria-label="Danh sách sản phẩm">
            <Toolbar total={result.meta.total} params={params} />
            {result.items.length > 0 ? (
              <>
                <ProductGrid products={result.items} list={params.view === 'list'} />
                <Pagination
                  page={result.meta.page}
                  totalPages={result.meta.totalPages}
                  params={params}
                />
              </>
            ) : (
              <EmptyState title="Chưa tìm thấy chiếc nón phù hợp">
                <p>
                  {filtered
                    ? 'Thử đổi từ khóa hoặc bộ lọc nhé.'
                    : 'Cửa hàng đang cập nhật sản phẩm.'}
                </p>
                {filtered && (
                  <Link className="btn btn-dark" href={shopHref({})}>
                    Xóa bộ lọc
                  </Link>
                )}
              </EmptyState>
            )}
          </section>
        </div>
      </FiltersProvider>
      <CustomCta />
    </>
  );
}
