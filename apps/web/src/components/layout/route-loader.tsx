'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

/**
 * Brand loader: an "N" inside a spinning ring, centred on the page. Shown while the first page loads
 * (server-rendered, so it appears before any script) and while the shopper navigates to another page.
 * Quick navigations never flash it: it only appears if the next page takes longer than a moment.
 */
export function RouteLoader() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(true); // true on the server: covers the very first paint
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const safety = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const current = useRef(pathname);

  // first load finished (hydrated) or the navigation reached its page
  useEffect(() => {
    current.current = pathname;
    clearTimeout(timer.current);
    clearTimeout(safety.current);
    const t = setTimeout(() => setVisible(false), 250);
    return () => clearTimeout(t);
  }, [pathname]);

  // a click on an internal link to another page starts a navigation
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
        return;
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === current.current) return;
      clearTimeout(timer.current);
      clearTimeout(safety.current);
      timer.current = setTimeout(() => setVisible(true), 180);
      safety.current = setTimeout(() => setVisible(false), 12_000); // never get stuck
    };
    const onShow = () => setVisible(false); // back/forward cache restore
    document.addEventListener('click', onClick, true);
    window.addEventListener('pageshow', onShow);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('pageshow', onShow);
      clearTimeout(timer.current);
      clearTimeout(safety.current);
    };
  }, []);

  return (
    <div
      className={`route-loader${visible ? ' on' : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Đang tải"
    >
      <div className="route-loader-mark" aria-hidden="true">
        <svg viewBox="0 0 100 100">
          <circle className="track" cx="50" cy="50" r="44" />
          <circle className="arc" cx="50" cy="50" r="44" />
        </svg>
        <span>N</span>
      </div>
    </div>
  );
}
