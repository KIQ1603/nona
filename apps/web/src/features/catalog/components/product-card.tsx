import Link from 'next/link';
import type { ProductListItem } from '@nona/contracts';
import { Price } from '@/components/ui/price';
import { QuickAddButton } from './quick-add-button';
import { WishlistButton } from './wishlist-button';

export function ProductCard({
  product,
  priority = false,
}: {
  product: ProductListItem;
  priority?: boolean;
}) {
  const href = `/san-pham/${product.slug}`;
  return (
    <article className="product-card">
      <div className="product-media">
        <Link href={href} tabIndex={-1} aria-hidden="true">
          {product.image && (
            <img
              src={product.image.url}
              alt=""
              width={product.image.width}
              height={product.image.height}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
            />
          )}
        </Link>
        {product.badge && <span className="product-badge">{product.badge}</span>}
        {product.availability === 'LOW_STOCK' && (
          <span className="product-status low">Sắp hết hàng</span>
        )}
        {product.availability === 'OUT_OF_STOCK' && (
          <span className="product-status">Hết hàng</span>
        )}
        <WishlistButton slug={product.slug} name={product.name} />
      </div>
      <div className="product-info">
        <small>{product.category.name}</small>
        <h3>
          <Link href={href}>{product.name}</Link>
        </h3>
        <Price
          priceVnd={product.priceVnd}
          compareAtPriceVnd={product.compareAtPriceVnd}
          from={product.hasMultiplePrices}
        />
      </div>
      <QuickAddButton product={product} />
    </article>
  );
}
