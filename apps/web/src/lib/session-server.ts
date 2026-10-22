import { type MeDto } from '@nona/contracts';
import { redirect } from 'next/navigation';
import type { ZodType, ZodTypeDef } from 'zod';
import { authHeaders, getMe } from './admin-server';
import { ApiError } from './api-client';
import { API_URL } from './env';

/** Only same-site relative paths may be used as a post-login destination (blocks open redirects). */
export function safeNext(value: string | string[] | undefined, fallback = '/tai-khoan'): string {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.startsWith('/') && !v.startsWith('//') && !v.includes('\\') ? v : fallback;
}

/** Guards a customer page on the server. The API still authorizes every request. */
export async function requireUser(nextPath: string): Promise<MeDto> {
  const me = await getMe();
  if (!me) redirect(`/dang-nhap?next=${encodeURIComponent(nextPath)}`);
  return me;
}

export async function userGet<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  nextPath: string,
): Promise<T> {
  const res = await fetch(`${API_URL}/v1${path}`, {
    headers: await authHeaders(),
    cache: 'no-store',
  }).catch(() => {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.');
  });
  if (res.status === 401) redirect(`/dang-nhap?next=${encodeURIComponent(nextPath)}`);
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, 'INTERNAL_ERROR', 'Yêu cầu không thành công.');
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(res.status, 'INVALID_RESPONSE', 'Dữ liệu máy chủ không hợp lệ.');
  return parsed.data;
}
