'use client';

import Link from 'next/link';
import { useCallback, useRef } from 'react';
import { useDialog } from '@/lib/use-dialog';
import { buildNav, type NavType } from '@/lib/site';
import { useOverlays } from './overlay-store';

export function MobileNav({ types }: { types: NavType[] }) {
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
      {buildNav(types).map((link) =>
        link.children ? (
          <div key={link.label} className="mobile-nav-group">
            <span>{link.label}</span>
            {link.children.map((c) => (
              <div key={c.href}>
                <Link href={c.href} onClick={close}>
                  {c.label}
                </Link>
                {c.sub?.map((g) => (
                  <Link key={g.href} href={g.href} className="sub" onClick={close}>
                    {g.label}
                  </Link>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Link key={link.href} href={link.href} onClick={close}>
            {link.label}
          </Link>
        ),
      )}
    </div>
  );
}
