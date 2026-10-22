'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

const FiltersContext = createContext<{ open: boolean; setOpen: (open: boolean) => void } | null>(
  null,
);

/** Lets the toolbar's mobile "Bộ lọc" button open the filter drawer rendered elsewhere in the page. */
export function FiltersProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <FiltersContext.Provider value={{ open, setOpen }}>{children}</FiltersContext.Provider>;
}

export function useFiltersDrawer() {
  const ctx = useContext(FiltersContext);
  if (!ctx) throw new Error('useFiltersDrawer must be used within FiltersProvider');
  return ctx;
}

export function FiltersToggle() {
  const { setOpen } = useFiltersDrawer();
  return (
    <button className="mobile-filter-toggle" type="button" onClick={() => setOpen(true)}>
      Bộ lọc <span aria-hidden="true">☷</span>
    </button>
  );
}
