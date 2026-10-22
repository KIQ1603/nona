import Link from 'next/link';

export const PAGE_SIZES = [10, 20, 50] as const;

/** Reads `pageSize` from the query string, limited to the offered sizes. */
export const pageSizeFrom = (v: string | string[] | undefined): number => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : 20;
};

/** Page numbers around the current page, with gaps shown as ellipses. */
function windowOf(page: number, last: number): (number | '…')[] {
  const keep = new Set([1, last, page - 1, page, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (page >= last - 2) [last - 1, last - 2, last - 3].forEach((n) => keep.add(n));
  const nums = [...keep].filter((n) => n >= 1 && n <= last).sort((a, b) => a - b);
  const out: (number | '…')[] = [];
  nums.forEach((n, i) => {
    if (i > 0 && n - nums[i - 1]! > 1) out.push('…');
    out.push(n);
  });
  return out;
}

/** Always-visible footer for admin lists: range, page numbers and rows per page. Server-rendered links. */
export function AdminPagination({
  basePath,
  query,
  page,
  pageSize,
  total,
}: {
  basePath: string;
  /** Current filters (everything except page and pageSize). */
  query: URLSearchParams;
  page: number;
  pageSize: number;
  total: number;
}) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  const href = (p: number, size = pageSize) => {
    const n = new URLSearchParams(query);
    n.delete('page');
    n.delete('pageSize');
    if (p > 1) n.set('page', String(p));
    if (size !== 20) n.set('pageSize', String(size));
    const s = n.toString();
    return s ? `${basePath}?${s}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav className="pager-admin" aria-label="Phân trang">
      <span className="pager-range">
        {total === 0 ? 'Không có kết quả' : `Hiển thị ${from}–${to} trên ${total}`}
      </span>
      <div className="pager-pages">
        {page > 1 ? (
          <Link className="pager-btn" href={href(page - 1)} aria-label="Trang trước">
            ‹ Trước
          </Link>
        ) : (
          <span className="pager-btn disabled">‹ Trước</span>
        )}
        {windowOf(page, last).map((n, i) =>
          n === '…' ? (
            <span key={`gap${i}`} className="pager-gap">
              …
            </span>
          ) : (
            <Link
              key={n}
              className={`pager-btn${n === page ? ' current' : ''}`}
              href={href(n)}
              aria-current={n === page ? 'page' : undefined}
            >
              {n}
            </Link>
          ),
        )}
        {page < last ? (
          <Link className="pager-btn" href={href(page + 1)} aria-label="Trang sau">
            Sau ›
          </Link>
        ) : (
          <span className="pager-btn disabled">Sau ›</span>
        )}
      </div>
      <div className="pager-size">
        <span>Số dòng</span>
        {PAGE_SIZES.map((s) => (
          <Link
            key={s}
            className={`pager-btn${s === pageSize ? ' current' : ''}`}
            href={href(1, s)}
          >
            {s}
          </Link>
        ))}
      </div>
    </nav>
  );
}
