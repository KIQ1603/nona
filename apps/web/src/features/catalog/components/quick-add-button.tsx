'use client';

import Link from 'next/link';
import type { ProductListItem } from '@nona/contracts';
import { useToast } from '@/components/ui/toast';
import { useCart } from '@/features/cart/cart-store';

/**
 * Single-variant products add straight to the cart. Products with several variants link to the
 * detail page so the shopper chooses explicitly. Sold-out products are disabled with a text label.
 */
export function QuickAddButton({ product }: { product: ProductListItem }) {
  const { add, busy } = useCart();
  const toast = useToast();

  if (product.availability === 'OUT_OF_STOCK') {
    return (
      <button className="btn btn-soft quick-add" type="button" disabled>
        Hết hàng
      </button>
    );
  }
  if (product.variantCount > 1) {
    return (
      <Link
        className="btn btn-soft quick-add"
        href={`/san-pham/${product.slug}`}
        aria-label={`Chọn màu / size ${product.name}`}
      >
        Chọn màu / size
      </Link>
    );
  }
  return (
    <button
      className="btn btn-soft quick-add"
      type="button"
      disabled={busy}
      aria-label={`Thêm nhanh ${product.name} vào giỏ`}
      onClick={async () => {
        if (await add(product.defaultVariantId)) toast(`Đã thêm “${product.name}” vào giỏ`);
      }}
    >
      Thêm nhanh vào giỏ
    </button>
  );
}
