import { Inject, Injectable } from '@nestjs/common';
import type { AuditEntry } from '../domain';
import { DatabaseService } from '../../../platform/database/database.service';

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

/**
 * Append-only audit trail. Pass the active transaction client so the audit row commits or rolls back
 * together with the change it describes.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async record(entry: AuditEntry, executor: Queryable = this.db): Promise<void> {
    await executor.query(
      `INSERT INTO audit_logs (actor_id, action, target_type, target_id, metadata, request_id)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
      [
        entry.actorId ?? null,
        entry.action,
        entry.targetType ?? null,
        entry.targetId ?? null,
        JSON.stringify(entry.metadata ?? {}),
        entry.requestId ?? null,
      ],
    );
  }

  async list(page: number, pageSize: number) {
    const [rows, total] = await Promise.all([
      this.db.query<{
        id: string;
        action: string;
        actor_email: string | null;
        target_type: string | null;
        target_id: string | null;
        metadata: Record<string, unknown>;
        created_at: Date;
      }>(
        `SELECT a.id, a.action, u.email AS actor_email, a.target_type, a.target_id, a.metadata, a.created_at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
         ORDER BY a.created_at DESC, a.id LIMIT $1 OFFSET $2`,
        [pageSize, (page - 1) * pageSize],
      ),
      this.db.query<{ n: string }>('SELECT COUNT(*) AS n FROM audit_logs'),
    ]);
    return {
      items: rows.rows.map((r) => ({
        id: r.id,
        action: r.action,
        actorEmail: r.actor_email,
        targetType: r.target_type,
        targetId: r.target_id,
        metadata: r.metadata,
        createdAt: r.created_at.toISOString(),
      })),
      meta: { page, pageSize, total: Number(total.rows[0]?.n ?? 0) },
    };
  }
}
