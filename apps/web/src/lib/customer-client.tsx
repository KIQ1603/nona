'use client';

import { meSchema, type MeDto } from '@nona/contracts';
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
import { ApiError } from './api-client';

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
interface CustomerApi {
  /** 'loading' until /api/me answered; then 'guest' or 'user'. */
  status: 'loading' | 'guest' | 'user';
  user: MeDto | null;
  request: <T>(
    method: Method,
    path: string,
    body?: unknown,
    options?: { idempotencyKey?: string },
  ) => Promise<T>;
  upload: <T>(path: string, form: FormData) => Promise<T>;
  signIn: (kind: 'login' | 'register', body: Record<string, unknown>) => Promise<MeDto>;
  signOut: () => Promise<void>;
  setUser: (me: MeDto) => void;
}
const CustomerContext = createContext<CustomerApi | null>(null);

async function toApiError(res: Response): Promise<ApiError> {
  const body = (await res.json().catch(() => null)) as {
    error?: {
      code?: never;
      message?: string;
      details?: Record<string, unknown>;
      requestId?: string;
    };
  } | null;
  const err = body?.error;
  const error = new ApiError(
    res.status,
    err?.code ?? 'INTERNAL_ERROR',
    err?.message ?? 'Yêu cầu không thành công.',
    err?.requestId,
  );
  (error as ApiError & { details?: unknown }).details = err?.details;
  return error;
}

export function CustomerProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<MeDto | null>(null);
  const [status, setStatus] = useState<CustomerApi['status']>('loading');
  const csrf = useRef<string | null>(null);

  const setUser = useCallback((me: MeDto | null) => {
    csrf.current = me?.csrfToken ?? null;
    setUserState(me);
    setStatus(me ? 'user' : 'guest');
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (res) => {
        const body = res.ok ? ((await res.json()) as { user?: unknown }) : null;
        const parsed = body?.user ? meSchema.safeParse(body.user) : null;
        if (!cancelled) setUser(parsed?.success ? parsed.data : null);
      })
      .catch(() => !cancelled && setUser(null));
    return () => {
      cancelled = true;
    };
  }, [setUser]);

  const request = useCallback<CustomerApi['request']>(
    async (method, path, body, options) => {
      const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' && csrf.current ? { 'x-csrf-token': csrf.current } : {}),
          ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }).catch(() => {
        throw new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.');
      });
      if (!res.ok) {
        const error = await toApiError(res);
        if (error.status === 401 && csrf.current) setUser(null); // session expired elsewhere
        throw error;
      }
      return res.status === 204 ? (undefined as never) : ((await res.json()) as never);
    },
    [setUser],
  );

  const upload = useCallback<CustomerApi['upload']>(async (path, form) => {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: csrf.current ? { 'x-csrf-token': csrf.current } : {},
      body: form,
    }).catch(() => {
      throw new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.');
    });
    if (!res.ok) throw await toApiError(res);
    return (await res.json()) as never;
  }, []);

  const signIn = useCallback<CustomerApi['signIn']>(
    async (kind, body) => {
      const raw = await request<Record<string, unknown>>('POST', `/auth/${kind}`, body);
      if ('mfaRequired' in raw)
        throw Object.assign(
          new Error('Tài khoản nhân viên vui lòng đăng nhập tại trang quản trị (/admin/login).'),
          { handled: true },
        );
      const me = meSchema.parse(raw);
      setUser(me);
      return me;
    },
    [request, setUser],
  );
  const signOut = useCallback(async () => {
    await request('POST', '/auth/logout').catch(() => undefined);
    setUser(null);
  }, [request, setUser]);

  const value = useMemo(
    () => ({ status, user, request, upload, signIn, signOut, setUser }),
    [status, user, request, upload, signIn, signOut, setUser],
  );
  return <CustomerContext.Provider value={value}>{children}</CustomerContext.Provider>;
}

export function useCustomer() {
  const ctx = useContext(CustomerContext);
  if (!ctx) throw new Error('useCustomer must be used within CustomerProvider');
  return ctx;
}

export function describeApiError(error: unknown): string {
  if (!(error instanceof ApiError))
    return error instanceof Error && (error as Error & { handled?: boolean }).handled
      ? error.message
      : 'Có lỗi không xác định.';
  const issues = (
    error as ApiError & { details?: { issues?: { path?: string; message?: string }[] } }
  ).details?.issues;
  if (issues?.length)
    return issues
      .map((i) => i.message)
      .filter(Boolean)
      .join('. ');
  return error.message;
}
