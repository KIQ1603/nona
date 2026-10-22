'use client';

import Link from 'next/link';
import { useCallback, useRef } from 'react';
import { useDialog } from '@/lib/use-dialog';
import { NAV_LINKS } from '@/lib/site';
import { useOverlays } from './overlay-store';

export function MobileNav() {
  const { open, hide } = useOverlays();
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => hide('nav'), [hide]);
  useDialog(open.nav, ref, close);

  return (
    <div
      ref={ref}
      className={`mobile-nav${open.nav ? ' open' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label="Menu"
      aria-hidden={!open.nav}
    >
      <button className="mobile-nav-close" type="button" aria-label="Đóng menu" onClick={close}>
        ×
      </button>
      {NAV_LINKS.map((link) => (
        <Link key={link.href} href={link.href} onClick={close}>
          {link.label}
        </Link>
      ))}
    </div>
  );
}
