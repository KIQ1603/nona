'use client';

import { useCallback, useState } from 'react';
import { describeError } from '@/lib/admin-client';

/** Wraps an async admin action with pending + error state so forms can't double-submit. */
export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setPending(true);
    setError(null);
    try {
      return await work();
    } catch (e) {
      setError(describeError(e));
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);
  return { pending, error, run, clearError: () => setError(null) };
}
