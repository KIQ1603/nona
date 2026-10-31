import Link from 'next/link';
import type { ProductListItem } from '@nona/contracts';
import { Price } from '@/components/ui/price';
import { QuickAddButton } from './quick-add-button';

/** Product card of the "Nón lá" page: rounded photo, name, short note, price, then "Thêm vào giỏ" and "Chi tiết". */
export function NonLaCard({
  product,
  cartLabel = 'Thêm vào giỏ',
  detailLabel = 'Chi tiết',
}: {
  product: ProductListItem;
  cartLabel?: string;
  detailLabel?: string;
}) {
  const href = `/san-pham/${product.slug}`;
  return (
    <article className="nl-card">
      <Link className="nl-img" href={href} tabIndex={-1} aria-hidden="true">
        {product.image && (
          <img
            src={product.image.url}
            alt=""
            width={product.image.width}
            height={product.image.height}
            loading="lazy"
            decoding="async"
          />
        )}
        {product.badge && <b>{product.badge}</b>}
        {product.availability === 'OUT_OF_STOCK' && <em>Hết hàng</em>}
      </Link>
      <div className="nl-info">
        <h3>
          <Link href={href}>{product.name}</Link>
        </h3>
        {product.summary && <p>{product.summary}</p>}
        <div className="nl-price">
          <Price
            priceVnd={product.priceVnd}
            compareAtPriceVnd={product.compareAtPriceVnd}
            from={product.hasMultiplePrices}
          />
        </div>
        <div className="nl-actions">
          <QuickAddButton product={product} label={cartLabel} className="nl-btn" />
          <Link className="nl-btn" href={href}>
            {detailLabel}
          </Link>
        </div>
      </div>
    </article>
  );
}
