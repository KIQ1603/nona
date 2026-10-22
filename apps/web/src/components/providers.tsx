'use client';

import type { ReactNode } from 'react';
import { CartProvider } from '@/features/cart/cart-store';
import { WishlistProvider } from '@/features/wishlist/wishlist-store';
import { CustomerProvider } from '@/lib/customer-client';
import { OverlayProvider } from './layout/overlay-store';
import { ToastProvider } from './ui/toast';

/** Order matters: toast → overlays → customer session → cart/wishlist (which depend on the session). */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <OverlayProvider>
        <CustomerProvider>
          <CartProvider>
            <WishlistProvider>{children}</WishlistProvider>
          </CartProvider>
        </CustomerProvider>
      </OverlayProvider>
    </ToastProvider>
  );
}
