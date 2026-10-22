'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type Surface = 'cart' | 'search' | 'nav';
interface OverlayApi {
  open: Record<Surface, boolean>;
  show: (surface: Surface) => void;
  hide: (surface: Surface) => void;
}
const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<Record<Surface, boolean>>({
    cart: false,
    search: false,
    nav: false,
  });
  // Only one modal surface at a time.
  const show = useCallback(
    (s: Surface) => setOpen({ cart: false, search: false, nav: false, [s]: true }),
    [],
  );
  const hide = useCallback((s: Surface) => setOpen((o) => ({ ...o, [s]: false })), []);
  const value = useMemo(() => ({ open, show, hide }), [open, show, hide]);
  return <OverlayContext.Provider value={value}>{children}</OverlayContext.Provider>;
}

export function useOverlays() {
  const ctx = useContext(OverlayContext);
  if (!ctx) throw new Error('useOverlays must be used within OverlayProvider');
  return ctx;
}
