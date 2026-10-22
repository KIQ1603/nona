'use client';

import { formatVnd, PRODUCT_COLORS, PRODUCT_STYLES, type ProductDetail } from '@nona/contracts';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useCart } from '@/features/cart/cart-store';
import { hatSVG, STRAW_NATURAL } from './hat-svg';
import { LeaveLink as Link, useLeave } from './leave';

export interface CollectionHandle {
  step: (dir: 1 | -1) => void;
}

const Arrow = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** The collection carousel: real products, real variants, real cart. */
export const CollectionSlide = forwardRef<CollectionHandle, { products: ProductDetail[] }>(
  function CollectionSlide({ products }, ref) {
    const [cur, setCur] = useState(0);
    const [variantBy, setVariantBy] = useState<Record<string, string>>({});
    const { add, busy } = useCart();
    const toast = useToast();
    const leave = useLeave();
    const box = useRef<HTMLDivElement>(null);
    const info = useRef<HTMLDivElement>(null);
    const flipping = useRef(false);
    const n = products.length;
    const p = products[cur];

    const fallbackHat = useMemo(
      () => hatSVG({ straw: STRAW_NATURAL, strap: '#b5442a', deco: 'band' }, 'collection'),
      [],
    );

    const change = useCallback(
      (to: number, dir: 1 | -1) => {
        if (n < 2 || flipping.current) return;
        const target = (to + n) % n;
        flipping.current = true;
        box.current
          ?.animate(
            [
              { transform: 'rotateY(0) scale(1)', opacity: 1 },
              { transform: `rotateY(${90 * dir}deg) scale(.8)`, opacity: 0 },
            ],
            { duration: 260, easing: 'ease-in' },
          )
          .finished.then(() => {
            setCur(target);
            requestAnimationFrame(() => {
              box.current
                ?.animate(
                  [
                    { transform: `rotateY(${-90 * dir}deg) scale(.8)`, opacity: 0 },
                    { transform: 'rotateY(0) scale(1)', opacity: 1 },
                  ],
                  { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' },
                )
                .finished.finally(() => (flipping.current = false));
            });
          })
          .catch(() => (flipping.current = false));
        info.current?.animate(
          [
            { opacity: 1, transform: 'translateY(0)' },
            { opacity: 0, transform: `translateY(${10 * dir}px)` },
            { opacity: 1, transform: 'translateY(0)' },
          ],
          { duration: 700, easing: 'ease' },
        );
      },
      [n],
    );
    useImperativeHandle(ref, () => ({ step: (dir) => change(cur + dir, dir) }), [change, cur]);

    if (!p)
      return (
        <div className="lp-wrap">
          <p className="lp-eyebrow" style={{ color: 'var(--terra)' }}>
            Bộ sưu tập
          </p>
          <h2 className="lp-h2 lp-fd" style={{ color: 'var(--green)' }}>
            Bộ sưu tập sắp ra mắt
          </h2>
          <div className="lp-actions">
            <Link className="lp-btn lp-btn-p" href="/shop">
              Xem cửa hàng
            </Link>
          </div>
        </div>
      );

    const variantId =
      variantBy[p.slug] ??
      (p.variants.find((v) => v.availability !== 'OUT_OF_STOCK') ?? p.variants[0])?.id;
    const variant = p.variants.find((v) => v.id === variantId);
    const soldOut = !variant || variant.availability === 'OUT_OF_STOCK';
    const image = p.images[0];
    const color = PRODUCT_COLORS.find((c) => c.code === p.colorCode)?.label;
    const style = PRODUCT_STYLES.find((s) => s.code === p.styleCode)?.label;
    const tags = [p.category.name, color, style].filter(Boolean) as string[];

    return (
      <div className="lp-wrap lp-grid cols-2">
        <div className="lp-collection-art" data-a="zoom">
          <div className="lp-stagebox">
            <div className="lp-disc" />
            <div className="lp-ring" />
            <div className="lp-stage3d" style={{ position: 'relative' }}>
              <div className="lp-hatbox" ref={box}>
                <div className="lp-float">
                  {image ? (
                    <img
                      className="lp-product-img"
                      src={image.url}
                      alt={image.alt}
                      draggable={false}
                    />
                  ) : (
                    <div
                      style={{ width: '100%' }}
                      dangerouslySetInnerHTML={{ __html: fallbackHat }}
                    />
                  )}
                </div>
              </div>
            </div>
            {n > 1 && (
              <>
                <button
                  type="button"
                  className="lp-nb prev"
                  aria-label="Mẫu trước"
                  onClick={() => change(cur - 1, -1)}
                >
                  <Arrow d="M15 6l-6 6 6 6" />
                </button>
                <button
                  type="button"
                  className="lp-nb next"
                  aria-label="Mẫu sau"
                  onClick={() => change(cur + 1, 1)}
                >
                  <Arrow d="M9 6l6 6-6 6" />
                </button>
              </>
            )}
          </div>
        </div>

        <div className="lp-collection-text">
          <div className="lp-eyebrow" data-a>
            Bộ sưu tập{' '}
            <span className="idx">
              {String(cur + 1).padStart(2, '0')}/{String(n).padStart(2, '0')}
            </span>
          </div>
          <div ref={info}>
            {p.badge && <div className="lp-pbadge">{p.badge}</div>}
            <h2 className="lp-h2 lp-fd">{p.name}</h2>
            {p.summary && <p className="lp-pdesc">{p.summary}</p>}
            <div className="lp-tags">
              {tags.map((t) => (
                <span className="lp-tagp" key={t}>
                  {t}
                </span>
              ))}
            </div>
            {p.variants.length > 1 && (
              <div className="lp-vrow">
                <span className="label">Màu / size</span>
                <div className="lp-variants" role="group" aria-label="Màu / size">
                  {p.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      aria-pressed={v.id === variantId}
                      disabled={v.availability === 'OUT_OF_STOCK'}
                      onClick={() => setVariantBy({ ...variantBy, [p.slug]: v.id })}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="lp-price">
              {variant ? formatVnd(variant.priceVnd) : ''}
              {variant?.compareAtPriceVnd ? (
                <del>{formatVnd(variant.compareAtPriceVnd)}</del>
              ) : null}
            </div>
          </div>
          <div className="lp-actions" data-a>
            <button
              type="button"
              className="lp-btn lp-btn-p"
              disabled={soldOut || busy}
              onClick={async () => {
                if (variant && (await add(variant.id))) toast(`Đã thêm “${p.name}” vào giỏ hàng`);
              }}
            >
              {soldOut ? 'Hết hàng' : 'Thêm vào giỏ'}
            </button>
            <button
              type="button"
              className="lp-btn lp-btn-g"
              disabled={soldOut || busy}
              onClick={async () => {
                if (variant && (await add(variant.id))) leave('/thanh-toan');
              }}
            >
              Đặt ngay
            </button>
            <Link className="lp-seeall" href={`/san-pham/${p.slug}`}>
              Xem chi tiết
            </Link>
          </div>
          {n > 1 && (
            <div className="lp-chips" data-a>
              {products.map((x, i) => (
                <button
                  key={x.slug}
                  type="button"
                  className={`lp-chip${i === cur ? ' on' : ''}`}
                  onClick={() => i !== cur && change(i, i > cur ? 1 : -1)}
                >
                  <span className="thumb">
                    {x.images[0] && <img src={x.images[0].url} alt="" draggable={false} />}
                  </span>
                  <span className="name">{x.name.replace(/^Nón\s+/i, '')}</span>
                </button>
              ))}
            </div>
          )}
          <p className="lp-swipehint">↔ Vuốt ngang để đổi mẫu nón</p>
        </div>
      </div>
    );
  },
);
