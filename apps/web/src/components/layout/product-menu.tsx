'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { NavLink } from '@/lib/site';

/**
 * The "Sản phẩm" dropdown: product types with their groups for quick access. Opens on hover or focus, and on
 * tap / Enter for touch and keyboard users; Escape or a click elsewhere closes it.
 */
export function ProductMenu({ item, current }: { item: NavLink; current?: boolean }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  const children = item.children ?? [];
  if (children.length === 0)
    return (
      <Link href={item.href} aria-current={current ? 'page' : undefined}>
        {item.label}
      </Link>
    );
  return (
    <div className={`nav-drop${open ? ' open' : ''}`} ref={root}>
      <button
        type="button"
        className="nav-drop-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        aria-current={current ? 'page' : undefined}
        onClick={() => setOpen(!open)}
      >
        {item.label}
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="m6 9 6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </button>
      <div className="nav-drop-panel">
        {children.map((c) => (
          <div key={c.href} className="nav-drop-group">
            <Link href={c.href} onClick={() => setOpen(false)}>
              {c.label}
            </Link>
            {c.sub?.map((g) => (
              <Link key={g.href} href={g.href} className="sub" onClick={() => setOpen(false)}>
                {g.label}
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
