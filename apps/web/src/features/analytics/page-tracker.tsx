'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';

const KEY = 'nona_visitor';

/** Random id the browser makes for itself; it is not linked to an account, IP or cookie. */
function visitorId(): string | null {
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) {
      const bytes = crypto.getRandomValues(new Uint8Array(18));
      id = Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
        .join('')
        .slice(0, 32);
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return null; // storage blocked: skip tracking rather than guess
  }
}

/** Sends one anonymous view per navigation. Failures are ignored; it must never affect the page. */
export function PageTracker() {
  const pathname = usePathname();
  const last = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname || last.current === pathname) return;
    const previous = last.current;
    last.current = pathname;
    const id = visitorId();
    if (!id) return;
    void fetch('/api/analytics/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        visitorId: id,
        path: pathname.slice(0, 300),
        referrer: previous === null ? document.referrer || undefined : undefined,
      }),
    }).catch(() => undefined);
  }, [pathname]);

  return null;
}
