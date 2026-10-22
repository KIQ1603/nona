import Link from 'next/link';
import { shopHref, type ShopParams } from '../lib/shop-params';
import { FiltersToggle } from './filters-context';
import { SortSelect } from './sort-select';

export function Toolbar({ total, params }: { total: number; params: ShopParams }) {
  return (
    <div className="toolbar">
      <p aria-live="polite">
        <strong>{total}</strong> sản phẩm
      </p>
      <div className="toolbar-actions">
        <FiltersToggle />
        <SortSelect params={params} />
        <div className="view-switch" role="group" aria-label="Kiểu hiển thị">
          <Link
            href={shopHref({ ...params, view: 'grid' })}
            aria-label="Hiển thị dạng lưới"
            aria-current={params.view === 'grid'}
            replace
            scroll={false}
          >
            ⠿
          </Link>
          <Link
            href={shopHref({ ...params, view: 'list' })}
            aria-label="Hiển thị dạng danh sách"
            aria-current={params.view === 'list'}
            replace
            scroll={false}
          >
            ☷
          </Link>
        </div>
      </div>
    </div>
  );
}
