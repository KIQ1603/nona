'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { formatVnd, type CartLine } from '@nona/contracts';
import { useCart } from './cart-store';

const ISSUE_TEXT: Record<NonNullable<CartLine['issue']>, (l: CartLine) => string> = {
  UNAVAILABLE: () => 'Sản phẩm này hiện không còn bán.',
  OUT_OF_STOCK: () => 'Tạm hết hàng.',
  DESIGN_UNAVAILABLE: () =>
    'Thiết kế này không còn hiệu lực. Hãy xóa dòng này hoặc tạo lại thiết kế.',
  INSUFFICIENT_STOCK: (l) => `Chỉ còn ${l.availableQuantity} sản phẩm — vui lòng giảm số lượng.`,
};

/** Cart contents + totals. Shared by the drawer and the /gio-hang page. Nothing here is computed locally. */
export function CartPanel({ onNavigate }: { onNavigate?: () => void }) {
  const { cart, loading, busy, setQuantity, remove, acknowledgePriceChanges } = useCart();
  // The shopper ticks what to pay for now; everything purchasable starts ticked.
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const buyable = useMemo(() => cart.lines.filter((l) => l.purchasable), [cart.lines]);
  const chosen = useMemo(() => buyable.filter((l) => !unticked.has(l.id)), [buyable, unticked]);
  const chosenSubtotal = chosen.reduce((sum, l) => sum + l.unitPriceVnd * l.quantity, 0);
  const allTicked = buyable.length > 0 && chosen.length === buyable.length;
  const toggle = (id: string) =>
    setUnticked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const checkoutHref = (ids: string[]) =>
    ids.length === cart.lines.length ? '/thanh-toan' : `/thanh-toan?chon=${ids.join(',')}`;

  if (loading)
    return (
      <div className="cart-empty" role="status">
        <p>Đang tải giỏ hàng…</p>
      </div>
    );
  if (cart.lines.length === 0) {
    return (
      <div className="cart-empty">
        <span aria-hidden="true">⌒</span>
        <h3>Giỏ hàng đang trống</h3>
        <p>Chọn một chiếc nón thật hợp với bạn nhé.</p>
        <Link className="btn btn-dark" href="/shop" onClick={onNavigate}>
          Đến cửa hàng
        </Link>
      </div>
    );
  }

  return (
    <>
      {cart.hasPriceChanges && (
        <div className="cart-alert" role="alert">
          <p>Giá một số sản phẩm đã thay đổi. Vui lòng kiểm tra lại.</p>
          <button
            className="link-button"
            type="button"
            disabled={busy}
            onClick={acknowledgePriceChanges}
          >
            Đã hiểu
          </button>
        </div>
      )}
      <div className="cart-select-bar">
        <label className="cart-check">
          <input
            type="checkbox"
            checked={allTicked}
            disabled={buyable.length === 0}
            onChange={() => setUnticked(allTicked ? new Set(buyable.map((l) => l.id)) : new Set())}
          />
          <span>
            Chọn tất cả ({chosen.length}/{buyable.length})
          </span>
        </label>
        <small>Tick những sản phẩm bạn muốn thanh toán lần này; phần còn lại ở lại giỏ hàng.</small>
      </div>
      <ul className="cart-items">
        {cart.lines.map((line) => (
          <li className={`cart-item${line.purchasable ? '' : ' unavailable'}`} key={line.id}>
            <label className="cart-check cart-line-check" aria-label={`Chọn ${line.productName}`}>
              <input
                type="checkbox"
                checked={line.purchasable && !unticked.has(line.id)}
                disabled={!line.purchasable}
                onChange={() => toggle(line.id)}
              />
            </label>
            <div className="cart-thumb">
              {line.image && (
                <img src={line.image.url} alt="" width={72} height={72} loading="lazy" />
              )}
            </div>
            <div>
              <h3>
                <Link href={`/san-pham/${line.productSlug}`} onClick={onNavigate}>
                  {line.productName}
                </Link>
              </h3>
              {line.design && (
                <p className="cart-line-design">
                  <img
                    src={`/api/custom-designs/versions/${line.design.versionId}/preview`}
                    alt=""
                    width={40}
                    height={50}
                    loading="lazy"
                  />
                  Thiết kế riêng của bạn
                </p>
              )}
              <p>
                {line.variantName !== 'Tiêu chuẩn' && <>{line.variantName} · </>}
                {formatVnd(line.unitPriceVnd)}
                {line.priceChange && <del> {formatVnd(line.priceChange.previousUnitPriceVnd)}</del>}
              </p>
              {line.priceChange && (
                <p className="cart-line-note">
                  Giá{' '}
                  {line.unitPriceVnd < line.priceChange.previousUnitPriceVnd
                    ? 'đã giảm'
                    : 'đã tăng'}{' '}
                  so với lúc bạn thêm vào giỏ.
                </p>
              )}
              {line.issue && <p className="cart-line-note issue">{ISSUE_TEXT[line.issue](line)}</p>}
              <div className="cart-item-controls">
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Giảm số lượng ${line.productName}`}
                  onClick={() => setQuantity(line.id, line.quantity - 1)}
                >
                  −
                </button>
                <output aria-label="Số lượng">{line.quantity}</output>
                <button
                  type="button"
                  disabled={busy || line.issue === 'OUT_OF_STOCK' || line.issue === 'UNAVAILABLE'}
                  aria-label={`Tăng số lượng ${line.productName}`}
                  onClick={() => setQuantity(line.id, line.quantity + 1)}
                >
                  +
                </button>
              </div>
              {line.purchasable && (
                <Link className="cart-buy-one" href={checkoutHref([line.id])} onClick={onNavigate}>
                  Mua riêng sản phẩm này
                </Link>
              )}
            </div>
            <button
              className="cart-remove"
              type="button"
              disabled={busy}
              aria-label={`Xóa ${line.productName}`}
              onClick={() => remove(line.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <div className="cart-footer">
        <div className="row">
          <span>Đã chọn {chosen.length} sản phẩm</span>
          <strong>{formatVnd(chosenSubtotal)}</strong>
        </div>
        {chosen.length > 0 ? (
          <Link
            className="btn btn-primary btn-block"
            href={checkoutHref(chosen.map((l) => l.id))}
            onClick={onNavigate}
          >
            Thanh toán ({chosen.length}) →
          </Link>
        ) : (
          <button className="btn btn-primary btn-block" type="button" disabled>
            Chọn sản phẩm để thanh toán
          </button>
        )}
        <small>Phí vận chuyển và tổng cuối cùng do hệ thống tính ở bước thanh toán.</small>
      </div>
    </>
  );
}
