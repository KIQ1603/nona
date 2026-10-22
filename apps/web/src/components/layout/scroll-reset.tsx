'use client';

import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/** The body is its own scroll area, so a page change has to scroll it back to the top itself. */
export function ScrollReset() {
  const path = usePathname();
  const search = useSearchParams().toString();
  useEffect(() => {
    document.getElementById('main')?.scrollTo({ top: 0 });
  }, [path, search]);
  return null;
}
