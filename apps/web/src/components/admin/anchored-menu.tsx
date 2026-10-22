'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

/**
 * A small menu that opens under its trigger. It is rendered on <body> with fixed positioning so it is never
 * clipped by a scrolling table, and it closes on outside click, Escape, scroll or resize.
 */
export function AnchoredMenu({
  open,
  anchor,
  onClose,
  align = 'left',
  matchWidth = false,
  children,
  label,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: 'left' | 'right';
  /** Make the menu at least as wide as its trigger (drop-down lists). */
  matchWidth?: boolean;
  children: ReactNode;
  label: string;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    const width = Math.max(menu.current?.offsetWidth ?? 220, matchWidth ? r.width : 0);
    const left = align === 'right' ? r.right - width : r.left;
    setPos({
      top: r.bottom + 6,
      left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
      width: r.width,
    });
  }, [open, anchor, align, matchWidth]);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !anchor.current?.contains(t)) onClose();
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    const openedAt = Date.now();
    // scrolling a trigger into view right as it is clicked must not close the menu it just opened
    const onScroll = () => Date.now() - openedAt > 250 && onClose();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, anchor, onClose]);

  if (!open) return null;
  return createPortal(
    <div
      ref={menu}
      className="anchored-menu"
      role="menu"
      aria-label={label}
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        ...(matchWidth && pos ? { minWidth: pos.width } : {}),
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
