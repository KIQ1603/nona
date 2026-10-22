'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useRef, type FormEvent } from 'react';
import { shopHref } from '@/features/catalog/lib/shop-params';
import { useDialog } from '@/lib/use-dialog';
import { useOverlays } from './overlay-store';

export function SearchPanel() {
  const router = useRouter();
  const { open, hide } = useOverlays();
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const close = useCallback(() => hide('search'), [hide]);
  useDialog(open.search, ref, close);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const q = input.current?.value.trim().slice(0, 80);
    close();
    router.push(shopHref({ q: q || undefined }));
  };

  return (
    <div
      ref={ref}
      className={`search-panel${open.search ? ' open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Tìm kiếm"
      aria-hidden={!open.search}
    >
      <button className="search-close" type="button" aria-label="Đóng tìm kiếm" onClick={close}>
        ×
      </button>
      <p className="eyebrow">Bạn đang tìm gì?</p>
      <form role="search" onSubmit={submit}>
        <div className="search-field">
          <label className="sr-only" htmlFor="site-search">
            Từ khóa tìm kiếm
          </label>
          <input
            ref={input}
            id="site-search"
            type="search"
            name="q"
            maxLength={80}
            placeholder="Nón sen, nón truyền thống..."
            autoComplete="off"
          />
          <button type="submit" aria-label="Tìm">
            ⌕
          </button>
        </div>
      </form>
      <p className="search-hint">Nhấn Enter để xem kết quả</p>
    </div>
  );
}
