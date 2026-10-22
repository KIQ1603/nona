'use client';

import type { MeDto, Permission } from '@nona/contracts';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { lastToastAt, useToast } from '@/components/ui/toast';
import { ApiError } from './api-client';

interface RequestOptions {
  idempotencyKey?: string;
  /** No automatic success notice (the caller shows its own, or this is one step of a longer flow). */
  quiet?: boolean;
}
interface AdminApi {
  me: MeDto;
  can: (permission: Permission) => boolean;
  request: <T>(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    options?: RequestOptions,
  ) => Promise<T>;
  upload: <T>(path: string, form: FormData, options?: RequestOptions) => Promise<T>;
}
const AdminContext = createContext<AdminApi | null>(null);

/** Fire-and-forget: tell the web server to drop cached storefront data after a successful admin write. */
function revalidateStorefront(path: string) {
  const tag = path.startsWith('/admin/settings')
    ? 'settings'
    : path.startsWith('/admin/')
      ? 'catalog'
      : null;
  if (!tag) return;
  void fetch('/admin/revalidate', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tag }),
  }).catch(() => undefined);
}

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
  (error as ApiError & { details?: Record<string, unknown> }).details = err?.details;
  return error;
}

export function AdminProvider({ me, children }: { me: MeDto; children: ReactNode }) {
  const [csrf] = useState(me.csrfToken);
  const toast = useToast();
  /** Every write tells the staff member what happened: errors at once, success unless a specific notice follows. */
  const succeeded = useCallback(
    (message: string, quiet?: boolean) => {
      if (quiet) return;
      const startedAt = Date.now();
      window.setTimeout(() => {
        if (lastToastAt < startedAt) toast(message, 'success');
      }, 400);
    },
    [toast],
  );
  const failed = useCallback(
    (error: unknown) => {
      toast(describeError(error), 'error');
      return error;
    },
    [toast],
  );
  const request = useCallback<AdminApi['request']>(
    async (method, path, body, options) => {
      const res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(method !== 'GET' ? { 'x-csrf-token': csrf } : {}),
          ...(options?.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }).catch(() => {
        throw method === 'GET'
          ? new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.')
          : failed(new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.'));
      });
      if (!res.ok) {
        const err = await toApiError(res);
        throw method === 'GET' ? err : failed(err);
      }
      if (method !== 'GET') {
        revalidateStorefront(path);
        succeeded(
          method === 'DELETE'
            ? 'Đã xóa'
            : method === 'POST'
              ? 'Đã thêm / thực hiện xong'
              : 'Đã lưu thay đổi',
          options?.quiet,
        );
      }
      return res.status === 204 ? (undefined as never) : ((await res.json()) as never);
    },
    [csrf, failed, succeeded],
  );
  const upload = useCallback<AdminApi['upload']>(
    async (path, form, options) => {
      const res = await fetch(`/api${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'x-csrf-token': csrf },
        body: form,
      }).catch(() => {
        throw failed(new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.'));
      });
      if (!res.ok) throw failed(await toApiError(res));
      revalidateStorefront(path);
      succeeded('Đã tải lên', options?.quiet);
      return (await res.json()) as never;
    },
    [csrf, failed, succeeded],
  );
  const value = useMemo<AdminApi>(
    () => ({ me, can: (p) => me.permissions.includes(p), request, upload }),
    [me, request, upload],
  );
  return <AdminContext.Provider value={value}>{children}</AdminContext.Provider>;
}

export function useAdmin() {
  const ctx = useContext(AdminContext);
  if (!ctx) throw new Error('useAdmin must be used inside AdminProvider');
  return ctx;
}

/** Human-readable message (incl. publish issues / field errors) for any thrown value. */
export function describeError(error: unknown): string {
  if (!(error instanceof ApiError))
    return error instanceof Error && (error as Error & { handled?: boolean }).handled
      ? error.message
      : 'Có lỗi không xác định.';
  const details = (error as ApiError & { details?: { issues?: unknown } }).details;
  const issues = details?.issues;
  if (Array.isArray(issues) && issues.length) {
    const lines = issues.map((i) =>
      typeof i === 'string'
        ? i
        : `${(i as { path?: string }).path ? `${(i as { path: string }).path}: ` : ''}${(i as { message?: string }).message ?? ''}`,
    );
    return `${error.message} ${lines.join('; ')}`;
  }
  return error.message;
}

export const newIdempotencyKey = () => crypto.randomUUID();
