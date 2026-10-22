'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastKind = 'success' | 'error' | 'info';
type Show = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<Show>(() => undefined);
export const useToast = () => useContext(ToastContext);

/** When the last toast was shown: lets automatic "saved" notices stay quiet if a specific one already appeared. */
export let lastToastAt = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ text: string; kind: ToastKind } | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const show = useCallback<Show>((text, kind = 'info') => {
    lastToastAt = Date.now();
    setToast({ text, kind });
    setVisible(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), kind === 'error' ? 5000 : 2800);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className={`toast${visible ? ' show' : ''} toast-${toast?.kind ?? 'info'}`}
        role={toast?.kind === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        <span className="toast-icon" aria-hidden="true">
          {toast?.kind === 'error' ? '!' : toast?.kind === 'success' ? '✓' : 'i'}
        </span>
        <span>{toast?.text}</span>
      </div>
    </ToastContext.Provider>
  );
}
