'use client';

import type { ProductListQuery } from '@nona/contracts';
import { usePathname, useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { Dropdown } from '@/components/ui/dropdown';
import { toShopSearch, type ShopParams } from '../lib/shop-params';

const OPTIONS: { value: string; label: string }[] = [
  { value: 'featured', label: 'Nổi bật' },
  { value: 'price-asc', label: 'Giá: thấp đến cao' },
  { value: 'price-desc', label: 'Giá: cao đến thấp' },
  { value: 'name', label: 'Tên A–Z' },
];

export function SortSelect({ params }: { params: ShopParams }) {
  const router = useRouter();
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  return (
    <>
      <label htmlFor="sort-select">Sắp xếp:</label>
      <Dropdown
        id="sort-select"
        ariaLabel="Sắp xếp"
        className="dd-sort"
        value={params.sort}
        options={OPTIONS}
        onChange={(v) => {
          const sort = v as ProductListQuery['sort'];
          startTransition(() =>
            router.replace(`${pathname}${toShopSearch({ ...params, sort, page: 1 })}`, {
              scroll: false,
            }),
          );
        }}
      />
    </>
  );
}
