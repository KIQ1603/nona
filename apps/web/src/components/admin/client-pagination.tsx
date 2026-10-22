'use client';

import { useEffect, useState } from 'react';

const SIZES = [10, 20, 50];

/** Paging for small lists that are loaded whole: returns the visible slice and the footer to render under the table. */
export function usePaged<T>(items: T[], initialSize = 10) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(initialSize);
  const last = Math.max(1, Math.ceil(items.length / size));
  useEffect(() => {
    if (page > last) setPage(last);
  }, [page, last]);
  const from = items.length === 0 ? 0 : (page - 1) * size + 1;
  const to = Math.min(items.length, page * size);
  const footer = (
    <nav className="pager-admin" aria-label="Phân trang">
      <span className="pager-range">
        {items.length === 0 ? 'Không có kết quả' : `Hiển thị ${from}–${to} trên ${items.length}`}
      </span>
      <div className="pager-pages">
        <button
          type="button"
          className="pager-btn"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          ‹ Trước
        </button>
        <span className="pager-btn current" aria-current="page">
          {page}/{last}
        </span>
        <button
          type="button"
          className="pager-btn"
          disabled={page >= last}
          onClick={() => setPage(page + 1)}
        >
          Sau ›
        </button>
      </div>
      <div className="pager-size">
        <span>Số dòng</span>
        {SIZES.map((s) => (
          <button
            key={s}
            type="button"
            className={`pager-btn${s === size ? ' current' : ''}`}
            onClick={() => {
              setSize(s);
              setPage(1);
            }}
          >
            {s}
          </button>
        ))}
      </div>
    </nav>
  );
  return { visible: items.slice((page - 1) * size, page * size), footer };
}
