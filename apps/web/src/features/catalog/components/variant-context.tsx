'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface Ctx {
  variantId: string | undefined;
  setVariantId: (id: string) => void;
}
const VariantCtx = createContext<Ctx | null>(null);

/** Shares the chosen variant between the gallery and the purchase panel (each colour has its own picture). */
export function VariantProvider({ initial, children }: { initial?: string; children: ReactNode }) {
  const [variantId, setVariantId] = useState(initial);
  return <VariantCtx.Provider value={{ variantId, setVariantId }}>{children}</VariantCtx.Provider>;
}

export const useVariantChoice = () => useContext(VariantCtx);
