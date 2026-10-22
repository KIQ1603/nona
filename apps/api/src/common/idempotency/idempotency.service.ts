import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type pg from 'pg';
import { AppError } from '../errors/app-error';
import { DatabaseService } from '../../platform/database/database.service';

/** Who the key belongs to: a signed-in user, or an opaque scope (e.g. a hashed guest cart token). */
export type IdempotencyOwner = { userId: string } | { scope: string };

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

const stable = (value: unknown): string =>
  JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  );

/**
 * Binds `Idempotency-Key` to (user, operation, request hash). The key row and the work commit in one
 * transaction, so a retry either sees the stored result or waits on the unique index until it exists.
 */
@Injectable()
export class IdempotencyService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  static requireKey(header: string | undefined): string {
    if (!header || header.length < 8 || header.length > 128) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REQUIRED',
        400,
        'Thiếu hoặc sai định dạng header Idempotency-Key (8–128 ký tự).',
      );
    }
    return header;
  }

  async run<T>(
    owner: IdempotencyOwner,
    operation: string,
    key: string,
    payload: unknown,
    status: number,
    work: (client: pg.PoolClient) => Promise<T>,
  ): Promise<IdempotentResult<T>> {
    const ownerKey = 'userId' in owner ? owner.userId : owner.scope;
    const requestHash = createHash('sha256').update(stable(payload)).digest('hex');
    return this.db.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO idempotency_keys (key, user_id, scope, operation, request_hash)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT ((COALESCE(user_id::text, scope)), operation, key) DO NOTHING RETURNING id`,
        [
          key,
          'userId' in owner ? owner.userId : null,
          'scope' in owner ? owner.scope : null,
          operation,
          requestHash,
        ],
      );
      if (inserted.rowCount === 1) {
        const body = await work(client);
        await client.query(
          'UPDATE idempotency_keys SET response_status = $1, response_body = $2::jsonb WHERE id = $3',
          [status, JSON.stringify(body), inserted.rows[0].id],
        );
        return { status, body, replayed: false };
      }
      const existing = await client.query<{
        request_hash: string;
        response_status: number | null;
        response_body: T | null;
      }>(
        'SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE COALESCE(user_id::text, scope)=$1 AND operation=$2 AND key=$3',
        [ownerKey, operation, key],
      );
      const row = existing.rows[0];
      if (!row || row.request_hash !== requestHash) {
        throw new AppError(
          'IDEMPOTENCY_KEY_REUSED',
          409,
          'Idempotency-Key đã được dùng cho một yêu cầu khác.',
        );
      }
      if (row.response_body === null || row.response_status === null) {
        throw new AppError('CONFLICT', 409, 'Yêu cầu đang được xử lý, vui lòng thử lại.');
      }
      return { status: row.response_status, body: row.response_body, replayed: true };
    });
  }
}
