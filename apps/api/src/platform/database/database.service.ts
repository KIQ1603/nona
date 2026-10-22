import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { ENV, type Env } from '../../config/env';

/** Owns the PostgreSQL pool. Repositories depend on this, never on `pg` directly. */
@Injectable()
export class DatabaseService implements OnApplicationShutdown {
  readonly pool: pg.Pool;

  constructor(@Inject(ENV) env: Env) {
    this.pool = new pg.Pool({
      connectionString: env.DATABASE_URL,
      max: 10,
      statement_timeout: 10_000,
      idle_in_transaction_session_timeout: 15_000,
    });
  }

  query<R extends pg.QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    return this.pool.query<R>(text, values);
  }

  /** Runs `work` in a transaction; rolls back on error. Used by order/inventory flows from Phase 4. */
  async transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
