'use client';

import { cartSchema, type CartDto } from '@nona/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/ui/toast';
import { describeApiError, useCustomer } from '@/lib/customer-client';

const EMPTY: CartDto = {
  lines: [],
  itemCount: 0,
  subtotalVnd: 0,
  hasPriceChanges: false,
  hasUnavailable: false,
  notices: [],
};

interface CartApi {
  cart: CartDto;
  loading: boolean;
  busy: boolean;
  /** Adds one variant. Returns true on success; errors surface as a toast. */
  add: (variantId: string, quantity?: number, designVersionId?: string) => Promise<boolean>;
  setQuantity: (itemId: string, quantity: number) => Promise<void>;
  remove: (itemId: string) => Promise<void>;
  acknowledgePriceChanges: () => Promise<void>;
  refresh: () => Promise<void>;
}
const CartContext = createContext<CartApi | null>(null);

/**
 * The server cart is the single source of truth (guest cookie or account). This store only mirrors
 * the last response; prices, stock and totals are never computed in the browser.
 */
export function CartProvider({ children }: { children: ReactNode }) {
  const { request, status, user } = useCustomer();
  const toast = useToast();
  const [cart, setCart] = useState<CartDto>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const apply = useCallback(
    (raw: unknown) => {
      const parsed = cartSchema.parse(raw);
      setCart(parsed);
      parsed.notices.forEach((n) => toast(n.message));
      return parsed;
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const raw = await request('GET', '/cart');
      if (mine === seq.current) setCart(cartSchema.parse(raw));
    } catch {
      /* keep the last known cart; the shopper can retry */
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [request]);

  // Reload whenever identity changes (first load, sign-in merge, sign-out).
  useEffect(() => {
    if (status !== 'loading') void refresh();
  }, [status, user?.id, refresh]);

  const mutate = useCallback(
    async (work: () => Promise<unknown>): Promise<boolean> => {
      setBusy(true);
      try {
        seq.current++;
        apply(await work());
        return true;
      } catch (error) {
        toast(describeApiError(error));
        void refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [apply, refresh, toast],
  );

  const api = useMemo<CartApi>(
    () => ({
      cart,
      loading,
      busy,
      refresh,
      add: (variantId, quantity = 1, designVersionId) =>
        mutate(() =>
          request('POST', '/cart/items', {
            variantId,
            quantity,
            ...(designVersionId ? { designVersionId } : {}),
          }),
        ),
      setQuantity: async (itemId, quantity) =>
        void (await mutate(() =>
          quantity < 1
            ? request('DELETE', `/cart/items/${itemId}`)
            : request('PATCH', `/cart/items/${itemId}`, { quantity }),
        )),
      remove: async (itemId) =>
        void (await mutate(() => request('DELETE', `/cart/items/${itemId}`))),
      acknowledgePriceChanges: async () =>
        void (await mutate(() => request('POST', '/cart/acknowledge-price-changes'))),
    }),
    [cart, loading, busy, refresh, mutate, request],
  );
  return <CartContext.Provider value={api}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
