import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProduct, getProducts } from '@/features/catalog/api/catalog.api';
import { getCustomCatalog } from '@/features/custom/custom.api';
import { VariantProvider } from '@/features/catalog/components/variant-context';
import { ProductGallery } from '@/features/catalog/components/product-gallery';
import { ProductGrid } from '@/features/catalog/components/product-grid';
import { PurchasePanel } from '@/features/catalog/components/purchase-panel';
import { productJsonLd, serializeJsonLd } from '@/features/catalog/lib/product-jsonld';
import { shopHref } from '@/features/catalog/lib/shop-params';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  if (!product) return { title: 'Không tìm thấy sản phẩm' };
  return {
    title: product.seoTitle?.replace(/\s*\|\s*NONA$/, '') ?? product.name,
    description: product.seoDescription ?? product.summary ?? undefined,
    alternates: { canonical: `/san-pham/${product.slug}` },
    openGraph: {
      title: product.name,
      description: product.summary ?? undefined,
      images: product.image ? [product.image.url] : undefined,
    },
  };
}

export default async function ProductPage({ params }: Props) {
  const product = await getProduct((await params).slug);
  if (!product) notFound();

  const [sameCategory, custom] = await Promise.all([
    getProducts({ category: product.category.slug, pageSize: 5 }),
    getCustomCatalog().catch(() => null),
  ]);
  let others = sameCategory.items.filter((p) => p.slug !== product.slug).slice(0, 4);
  if (others.length < 4) {
    // Keep the row full: top up with other products from the shop.
    const more = await getProducts({ pageSize: 8 });
    const seen = new Set([product.slug, ...others.map((p) => p.slug)]);
    others = [...others, ...more.items.filter((p) => !seen.has(p.slug))].slice(0, 4);
  }
  const customizable =
    !!custom?.options.enabled && custom.products.some((p) => p.slug === product.slug);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Đường dẫn">
        <ol>
          <li>
            <Link href="/">Trang chủ</Link>
          </li>
          <li>
            <Link href="/shop">Shop</Link>
          </li>
          <li>
            <Link href={shopHref({ category: product.category.slug })}>
              {product.category.name}
            </Link>
          </li>
          <li aria-current="page">{product.name}</li>
        </ol>
      </nav>

      <VariantProvider
        initial={
          (product.variants.find((v) => v.availability !== 'OUT_OF_STOCK') ?? product.variants[0])
            ?.id
        }
      >
        <article className="product-detail">
          <ProductGallery images={product.images} name={product.name} />
          <div className="detail-info">
            <p className="eyebrow">
              <Link href={shopHref({ category: product.category.slug })}>
                {product.category.name}
              </Link>
            </p>
            <h1>{product.name}</h1>
            {product.summary && <p className="summary">{product.summary}</p>}
            <PurchasePanel product={product} customizable={customizable} />
            {product.description && (
              <div className="detail-description">
                <h2>Về chiếc nón này</h2>
                <p>{product.description}</p>
                <ul className="craft-points">
                  <li>Hoàn thiện thủ công bởi nghệ nhân Việt</li>
                  <li>Đổi trả theo chính sách cửa hàng</li>
                </ul>
              </div>
            )}
          </div>
        </article>
      </VariantProvider>

      {others.length > 0 && (
        <section className="related" aria-labelledby="related-title">
          <h2 id="related-title">Có thể bạn cũng thích</h2>
          <ProductGrid products={others} />
        </section>
      )}

      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(productJsonLd(product)) }}
      />
    </>
  );
}
