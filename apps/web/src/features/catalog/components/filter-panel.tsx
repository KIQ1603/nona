'use client';

import { formatVnd, PRODUCT_COLORS, PRODUCT_STYLES } from '@nona/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useDialog } from '@/lib/use-dialog';
import { toShopSearch, type ShopParams } from '../lib/shop-params';
import { useFiltersDrawer } from './filters-context';

const STEP = 10_000;

function toggled(list: string[], code: string) {
  return list.includes(code) ? list.filter((c) => c !== code) : [...list, code];
}

export function FilterPanel({
  params,
  priceMinVnd,
  priceMaxVnd,
}: {
  params: ShopParams;
  priceMinVnd: number;
  priceMaxVnd: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const { open, setOpen } = useFiltersDrawer();
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDialog(open, ref, close);

  const sliderMin = Math.floor(priceMinVnd / STEP) * STEP;
  const sliderMax = Math.max(Math.ceil(priceMaxVnd / 50_000) * 50_000, sliderMin + STEP);
  const applied = params.maxPriceVnd ?? sliderMax;
  const [price, setPrice] = useState(applied);
  const [openGroups, setOpenGroups] = useState({ price: true, color: true, style: true });
  const debounce = useRef<number | undefined>(undefined);

  useEffect(() => setPrice(applied), [applied]);
  useEffect(() => () => window.clearTimeout(debounce.current), []);

  const navigate = (patch: Partial<ShopParams>) => {
    const search = toShopSearch({ ...params, ...patch, page: 1 });
    startTransition(() => router.replace(`${pathname}${search}`, { scroll: false }));
  };

  const onPrice = (value: number) => {
    setPrice(value);
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(
      () => navigate({ maxPriceVnd: value >= sliderMax ? undefined : value }),
      350,
    );
  };

  const hasFilters = Boolean(
    params.category ||
    params.q ||
    params.maxPriceVnd !== undefined ||
    params.colors.length ||
    params.styles.length,
  );
  const toggleGroup = (g: keyof typeof openGroups) => setOpenGroups((o) => ({ ...o, [g]: !o[g] }));

  return (
    <>
      <div className={`overlay${open ? ' open' : ''}`} onClick={close} aria-hidden="true" />
      <aside
        ref={ref}
        className={`filters${open ? ' open' : ''}`}
        aria-label="Bộ lọc sản phẩm"
        aria-busy={pending}
        {...(open ? { role: 'dialog', 'aria-modal': true } : {})}
      >
        <div className="filter-heading">
          <h2>Bộ lọc</h2>
          <div>
            {hasFilters && (
              <button
                className="link-button"
                type="button"
                onClick={() =>
                  navigate({
                    category: undefined,
                    q: undefined,
                    maxPriceVnd: undefined,
                    colors: [],
                    styles: [],
                  })
                }
              >
                Đặt lại
              </button>
            )}
            <button className="filter-close" type="button" aria-label="Đóng bộ lọc" onClick={close}>
              ×
            </button>
          </div>
        </div>

        <div className={`filter-group${openGroups.price ? ' open' : ''}`}>
          <button
            className="filter-title"
            type="button"
            aria-expanded={openGroups.price}
            onClick={() => toggleGroup('price')}
          >
            Mức giá <span aria-hidden="true">{openGroups.price ? '−' : '+'}</span>
          </button>
          <div className="filter-content price-filter">
            <label className="sr-only" htmlFor="price-range">
              Giá tối đa
            </label>
            <input
              id="price-range"
              type="range"
              min={sliderMin}
              max={sliderMax}
              step={STEP}
              value={price}
              onChange={(e) => onPrice(Number(e.target.value))}
              aria-valuetext={formatVnd(price)}
            />
            <div className="price-range">
              <span>{formatVnd(sliderMin)}</span>
              <strong>{formatVnd(price)}</strong>
            </div>
          </div>
        </div>

        <div className={`filter-group${openGroups.color ? ' open' : ''}`}>
          <button
            className="filter-title"
            type="button"
            aria-expanded={openGroups.color}
            onClick={() => toggleGroup('color')}
          >
            Màu sắc <span aria-hidden="true">{openGroups.color ? '−' : '+'}</span>
          </button>
          <div className="filter-content color-list">
            {PRODUCT_COLORS.map((c) => (
              <button
                key={c.code}
                type="button"
                aria-pressed={params.colors.includes(c.code)}
                aria-label={`Màu ${c.label.toLowerCase()}`}
                title={c.label}
                style={{ '--swatch': c.swatch } as React.CSSProperties}
                onClick={() => navigate({ colors: toggled(params.colors, c.code) })}
              />
            ))}
          </div>
        </div>

        <div className={`filter-group${openGroups.style ? ' open' : ''}`}>
          <button
            className="filter-title"
            type="button"
            aria-expanded={openGroups.style}
            onClick={() => toggleGroup('style')}
          >
            Phong cách <span aria-hidden="true">{openGroups.style ? '−' : '+'}</span>
          </button>
          <div className="filter-content checkbox-list">
            {PRODUCT_STYLES.map((s) => (
              <label key={s.code}>
                <input
                  type="checkbox"
                  checked={params.styles.includes(s.code)}
                  onChange={() => navigate({ styles: toggled(params.styles, s.code) })}
                />
                <span aria-hidden="true" />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        <div className="filter-note">
          <span aria-hidden="true">✦</span>
          <p>Mỗi sản phẩm đều được hoàn thiện thủ công bởi nghệ nhân Việt.</p>
        </div>
      </aside>
    </>
  );
}
