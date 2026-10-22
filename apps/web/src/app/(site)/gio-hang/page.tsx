import type { Metadata } from 'next';
import { CartPanel } from '@/features/cart/cart-panel';

export const metadata: Metadata = { title: 'Giỏ hàng', robots: { index: false } };

export default function CartPage() {
  return (
    <div className="cart-page">
      <h1>Giỏ hàng</h1>
      <CartPanel />
    </div>
  );
}
