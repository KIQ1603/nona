import { logger } from '../logger.js';

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Triggers an API-side job. Payment reconciliation, order expiry and refunds are business logic that
 * lives in the API (one implementation, one set of tests); the worker is only the scheduler.
 */
export async function callInternalJob(
  config: { apiUrl: string; internalToken?: string },
  name: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<unknown | null> {
  if (!config.internalToken) return null; // not configured: nothing to do (and nothing to leak)
  try {
    const res = await fetchImpl(`${config.apiUrl}/v1/internal/jobs/${name}`, {
      method: 'POST',
      headers: { 'x-internal-token': config.internalToken },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      logger.error({ job: name, status: res.status }, 'internal job rejected');
      return null;
    }
    return await res.json();
  } catch (error) {
    logger.error({ job: name, err: (error as Error).message }, 'internal job call failed');
    return null;
  }
}
