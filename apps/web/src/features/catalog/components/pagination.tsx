import Link from 'next/link';
import { shopHref, type ShopParams } from '../lib/shop-params';

export function Pagination({
  page,
  totalPages,
  params,
}: {
  page: number;
  totalPages: number;
  params: ShopParams;
}) {
  if (totalPages <= 1) return null;
  const go = (p: number) => shopHref({ ...params, page: p });
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - page) <= 1,
  );
  return (
    <nav className="pagination" aria-label="Phân trang">
      {page > 1 ? (
        <Link href={go(page - 1)} rel="prev">
          ← Trước
        </Link>
      ) : (
        <span className="disabled" aria-disabled="true">
          ← Trước
        </span>
      )}
      {pages.map((p, i) => (
        <span key={p} style={{ display: 'contents' }}>
          {i > 0 && p - pages[i - 1]! > 1 && <span aria-hidden="true">…</span>}
          {p === page ? (
            <span aria-current="page">{p}</span>
          ) : (
            <Link href={go(p)} aria-label={`Trang ${p}`}>
              {p}
            </Link>
          )}
        </span>
      ))}
      {page < totalPages ? (
        <Link href={go(page + 1)} rel="next">
          Sau →
        </Link>
      ) : (
        <span className="disabled" aria-disabled="true">
          Sau →
        </span>
      )}
    </nav>
  );
}
