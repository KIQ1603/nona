'use client';

import { useCallback, useState } from 'react';
import { describeApiError } from '@/lib/customer-client';

/** Pending + error state for customer-facing async actions. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(describeApiError(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, run };
}
