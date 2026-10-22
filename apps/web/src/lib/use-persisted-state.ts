'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * localStorage-backed state that is SSR-safe: the first render always uses `initial` (matching the
 * server), and the stored value is applied after mount. `ready` tells consumers hydration finished.
 */
export function usePersistedState<T>(
  key: string,
  initial: T,
  validate: (value: unknown) => value is T,
) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);
  const validateRef = useRef(validate);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (validateRef.current(parsed)) setValue(parsed);
      }
    } catch {
      /* storage unavailable or corrupt: start empty */
    }
    setReady(true);
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* ignore quota/availability errors */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update, ready] as const;
}
