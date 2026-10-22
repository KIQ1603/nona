'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { wishlistSchema } from '@nona/contracts';
import { useState } from 'react';
import { useCustomer } from '@/lib/customer-client';
import { usePersistedState } from '@/lib/use-persisted-state';

const isSlugs = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

interface WishlistApi {
  slugs: string[];
  has: (slug: string) => boolean;
  /** Returns the new state (true = now saved). */
  toggle: (slug: string) => Promise<boolean>;
}
const WishlistContext = createContext<WishlistApi | null>(null);

/**
 * Guests keep favourites in the browser; signed-in users keep them on the server.
 * On sign-in the browser list is merged into the account once, then cleared locally.
 */
export function WishlistProvider({ children }: { children: ReactNode }) {
  const { status, user, request } = useCustomer();
  const [local, setLocal, localReady] = usePersistedState<string[]>(
    'nona.wishlist.v1',
    [],
    isSlugs,
  );
  const [remote, setRemote] = useState<string[]>([]);
  const mergedFor = useRef<string | null>(null);

  useEffect(() => {
    if (status !== 'user' || !user || !localReady) {
      if (status === 'guest') {
        setRemote([]);
        mergedFor.current = null;
      }
      return;
    }
    if (mergedFor.current === user.id) return;
    mergedFor.current = user.id;
    (async () => {
      try {
        const res = local.length
          ? await request('POST', '/wishlist/merge', { slugs: local })
          : await request('GET', '/wishlist');
        setRemote(wishlistSchema.parse(res).slugs);
        if (local.length) setLocal([]);
      } catch {
        /* keep local favourites if the merge failed */
      }
    })();
  }, [status, user, localReady, local, request, setLocal]);

  const slugs = status === 'user' ? remote : local;
  const has = useCallback((slug: string) => slugs.includes(slug), [slugs]);

  const toggle = useCallback(
    async (slug: string) => {
      const saved = !slugs.includes(slug);
      if (status !== 'user') {
        setLocal((prev) =>
          prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug],
        );
        return saved;
      }
      setRemote((prev) => (saved ? [slug, ...prev] : prev.filter((s) => s !== slug))); // optimistic
      try {
        const res = saved
          ? await request('POST', '/wishlist/items', { productSlug: slug })
          : await request('DELETE', `/wishlist/items/${slug}`);
        setRemote(wishlistSchema.parse(res).slugs);
      } catch {
        setRemote((prev) => (saved ? prev.filter((s) => s !== slug) : [slug, ...prev]));
        return !saved;
      }
      return saved;
    },
    [slugs, status, request, setLocal],
  );

  const value = useMemo(() => ({ slugs, has, toggle }), [slugs, has, toggle]);
  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist() {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
