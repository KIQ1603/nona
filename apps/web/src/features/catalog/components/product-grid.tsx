import type { ProductListItem } from '@nona/contracts';
import { ProductCard } from './product-card';

export function ProductGrid({
  products,
  list = false,
}: {
  products: ProductListItem[];
  list?: boolean;
}) {
  return (
    <div className={`product-grid${list ? ' list-view' : ''}`}>
      {products.map((product, index) => (
        <ProductCard key={product.id} product={product} priority={index < 4} />
      ))}
    </div>
  );
}
