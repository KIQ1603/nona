import { apiErrorSchema, type ErrorCode } from '@nona/contracts';
import type { ZodType, ZodTypeDef } from 'zod';
import { API_URL } from './env';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE',
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

interface FetchOptions {
  revalidate?: number;
  tags?: string[];
}

/**
 * Typed GET against the API. Responses are validated against the shared contract so a drifting
 * backend fails loudly here rather than rendering broken UI.
 */
export async function apiGet<T>(
  path: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
  options: FetchOptions = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/v1${path}`, {
      headers: { accept: 'application/json' },
      next: { revalidate: options.revalidate ?? 15, tags: options.tags },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Không thể kết nối máy chủ.');
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = apiErrorSchema.safeParse(body);
    if (parsed.success) {
      throw new ApiError(
        res.status,
        parsed.data.error.code,
        parsed.data.error.message,
        parsed.data.error.requestId,
      );
    }
    throw new ApiError(res.status, 'INTERNAL_ERROR', 'Yêu cầu không thành công.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success)
    throw new ApiError(res.status, 'INVALID_RESPONSE', 'Dữ liệu máy chủ không hợp lệ.');
  return parsed.data;
}
