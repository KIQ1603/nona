import Link from 'next/link';
import type { CategoryDto } from '@nona/contracts';
import { shopHref, type ShopParams } from '../lib/shop-params';

const SYMBOLS: Record<string, string> = {
  'non-truyen-thong': '⌒',
  'non-hoa': '〽',
  'non-thoi-trang': '◯',
  'qua-tang-mini': '⌁',
};

export function CategoryStrip({
  categories,
  params,
}: {
  categories: CategoryDto[];
  params: ShopParams;
}) {
  const base = { ...params, category: undefined, page: 1 };
  return (
    <nav className="category-strip" aria-label="Danh mục sản phẩm">
      <Link className="category" href={shopHref(base)} aria-current={!params.category}>
        <span aria-hidden="true">✦</span>Tất cả
      </Link>
      {categories.map((c) => (
        <Link
          key={c.slug}
          className="category"
          href={shopHref({ ...base, category: c.slug })}
          aria-current={params.category === c.slug}
        >
          <span aria-hidden="true">{SYMBOLS[c.slug] ?? '◌'}</span>
          {c.name}
        </Link>
      ))}
    </nav>
  );
}
