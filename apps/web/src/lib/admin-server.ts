import { meSchema, type MeDto } from '@nona/contracts';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { ZodType, ZodTypeDef } from 'zod';
import { ApiError } from './api-client';
import { API_URL } from './env';

const SESSION_COOKIE = 'nona_session';

export async function authHeaders(): Promise<HeadersInit> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const forwarded = (await headers()).get('x-forwarded-for');
  return {
    accept: 'application/json',
    ...(token ? { cookie: `${SESSION_COOKIE}=${token}` } : {}),
    // Lets the API rate-limit the real visitor instead of the web server's own address.
    ...(forwarded ? { 'x-forwarded-for': forwarded } : {}),
  };
}

/** Server-side GET against the admin API with the visitor's session cookie. Never cached. */
export async function adminGet<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, { headers: await authHeaders(), cache: 'no-store' });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.');
  }
  if (res.status === 401) redirect('/admin/login');
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { code?: never; message?: string; requestId?: string } } | null)
      ?.error;
    throw new ApiError(
      res.status,
      err?.code ?? 'INTERNAL_ERROR',
      err?.message ?? 'Yêu cầu không thành công.',
      err?.requestId,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(res.status, 'INVALID_RESPONSE', 'Dữ liệu máy chủ không hợp lệ.');
  return parsed.data;
}

export async function getMe(): Promise<MeDto | null> {
  const res = await fetch(`${API_URL}/v1/me`, {
    headers: await authHeaders(),
    cache: 'no-store',
  }).catch(() => null);
  if (!res?.ok) return null;
  const parsed = meSchema.safeParse(await res.json().catch(() => null));
  return parsed.success ? parsed.data : null;
}

/** Guards an admin page. Authorization is still enforced by the API on every call. */
export async function requireStaff(): Promise<MeDto> {
  const me = await getMe();
  if (!me || !me.permissions.includes('admin:access')) redirect('/admin/login');
  if (me.mfaRestricted) redirect('/admin/security-setup'); // policy: enrol in MFA before using the admin area
  return me;
}
