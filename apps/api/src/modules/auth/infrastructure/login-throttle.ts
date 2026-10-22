import { Injectable } from '@nestjs/common';

const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 5;

/**
 * Per (ip,email) failed-login limiter. In-memory is sufficient for a single API replica;
 * move the counters to Redis before running several replicas (tracked in Phase 7 hardening).
 */
@Injectable()
export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  isBlocked(key: string, max = MAX_FAILURES, now = Date.now()): boolean {
    return this.recent(key, now).length >= max;
  }

  recordFailure(key: string, now = Date.now()): void {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  /** Drops all counters (used by tests). */
  clear(): void {
    this.failures.clear();
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}
