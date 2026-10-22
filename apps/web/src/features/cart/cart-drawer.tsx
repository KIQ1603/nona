'use client';

import Link from 'next/link';
import { useCallback, useRef } from 'react';
import { useOverlays } from '@/components/layout/overlay-store';
import { useDialog } from '@/lib/use-dialog';
import { CartPanel } from './cart-panel';

export function CartDrawer() {
  const { open, hide } = useOverlays();
  const ref = useRef<HTMLElement>(null);
  const close = useCallback(() => hide('cart'), [hide]);
  useDialog(open.cart, ref, close);

  return (
    <>
      <div className={`overlay${open.cart ? ' open' : ''}`} onClick={close} aria-hidden="true" />
      <aside
        ref={ref}
        className={`drawer${open.cart ? ' open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        aria-hidden={!open.cart}
      >
        <div className="drawer-header">
          <div>
            <p className="eyebrow">Giỏ hàng</p>
            <h2 id="cart-title">Những món bạn chọn</h2>
          </div>
          <button className="drawer-close" type="button" aria-label="Đóng giỏ hàng" onClick={close}>
            ×
          </button>
        </div>
        <CartPanel onNavigate={close} />
        <Link className="drawer-viewall" href="/gio-hang" onClick={close}>
          Xem trang giỏ hàng →
        </Link>
      </aside>
    </>
  );
}
