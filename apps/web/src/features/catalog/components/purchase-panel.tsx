'use client';

import type { ProductDetail } from '@nona/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { useVariantChoice } from './variant-context';
import { Price } from '@/components/ui/price';
import { useToast } from '@/components/ui/toast';
import { useCart } from '@/features/cart/cart-store';
import { useWishlist } from '@/features/wishlist/wishlist-store';

const STOCK_TEXT = {
  IN_STOCK: { text: 'Còn hàng', className: '' },
  LOW_STOCK: { text: 'Sắp hết hàng — chỉ còn số lượng ít', className: 'low' },
  OUT_OF_STOCK: { text: 'Tạm hết hàng', className: 'out' },
} as const;

export function PurchasePanel({
  product,
  customizable = false,
}: {
  product: ProductDetail;
  customizable?: boolean;
}) {
  const { add, busy } = useCart();
  const { has, toggle } = useWishlist();
  const toast = useToast();
  const firstAvailable =
    product.variants.find((v) => v.availability !== 'OUT_OF_STOCK') ?? product.variants[0];
  const [localId, setLocalId] = useState(firstAvailable?.id);
  const shared = useVariantChoice();
  const variantId = shared?.variantId ?? localId;
  const setVariantId = shared?.setVariantId ?? setLocalId;
  const variant = product.variants.find((v) => v.id === variantId) ?? firstAvailable;
  if (!variant) return null;

  const stock = STOCK_TEXT[variant.availability];
  const soldOut = variant.availability === 'OUT_OF_STOCK';
  const multiple = product.variants.length > 1;
  const saved = has(product.slug);

  return (
    <>
      <Price
        className="detail-price"
        priceVnd={variant.priceVnd}
        compareAtPriceVnd={variant.compareAtPriceVnd}
      />

      {multiple && (
        <>
          <p className="option-label" id="variant-label">
            Màu / size
          </p>
          <ul className="variant-list" role="group" aria-labelledby="variant-label">
            {product.variants.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  aria-pressed={v.id === variant.id}
                  disabled={v.availability === 'OUT_OF_STOCK'}
                  onClick={() => setVariantId(v.id)}
                >
                  {v.name}
                  {v.availability === 'OUT_OF_STOCK' && (
                    <span className="sr-only"> (hết hàng)</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className={`stock-note ${stock.className}`} role="status">
        {stock.text}
      </p>

      <div className="detail-actions">
        <button
          className="btn btn-primary"
          type="button"
          disabled={soldOut || busy}
          onClick={async () => {
            if (await add(variant.id)) toast(`Đã thêm “${product.name}” vào giỏ`);
          }}
        >
          {soldOut ? 'Hết hàng' : 'Thêm vào giỏ'}
        </button>
        <button
          className="btn btn-soft"
          type="button"
          aria-pressed={saved}
          onClick={async () =>
            toast(
              (await toggle(product.slug))
                ? 'Đã lưu vào danh sách yêu thích'
                : 'Đã bỏ khỏi danh sách yêu thích',
            )
          }
        >
          {saved ? '♥ Đã lưu' : '♡ Yêu thích'}
        </button>
      </div>

      {customizable && (
        <aside className="custom-callout" aria-label="Thiết kế riêng">
          <div>
            <strong>Tạo chiếc nón phong cách riêng</strong>
            <p>Chọn màu và gắn charm của cửa hàng lên mẫu này.</p>
          </div>
          <Link
            className="btn btn-dark"
            href={`/thiet-ke-non?sanpham=${encodeURIComponent(product.slug)}&v=${variant.id}`}
          >
            Thiết kế ngay
          </Link>
        </aside>
      )}
    </>
  );
}
