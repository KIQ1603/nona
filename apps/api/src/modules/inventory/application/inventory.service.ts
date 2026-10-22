import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { inventoryAdjustmentSchema } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';

type Adjustment = z.infer<typeof inventoryAdjustmentSchema>;

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(IdempotencyService) private readonly idempotency: IdempotencyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /**
   * Appends one ledger movement. The variant row is locked so concurrent adjustments serialize and
   * the "never below zero" check cannot be raced. The whole operation is idempotent per key.
   */
  adjust(actor: { userId: string; requestId?: string }, key: string, input: Adjustment) {
    if ((input.reason === 'RECEIPT' || input.reason === 'RETURN') && input.delta < 0) {
      throw AppError.validation({
        issues: [{ path: 'delta', message: 'Nhập kho/hoàn trả phải là số dương' }],
      });
    }
    return this.idempotency.run(
      { userId: actor.userId },
      'inventory.adjust',
      key,
      input,
      201,
      async (client) => {
        const variant = await client.query<{ sku: string }>(
          'SELECT sku FROM product_variants WHERE id = $1 FOR UPDATE',
          [input.variantId],
        );
        if (!variant.rows[0]) throw AppError.notFound('Không tìm thấy biến thể.');
        const stock = Number(
          (
            await client.query<{ s: string }>(
              'SELECT COALESCE(SUM(delta),0) AS s FROM inventory_movements WHERE variant_id = $1',
              [input.variantId],
            )
          ).rows[0]!.s,
        );
        if (stock + input.delta < 0) {
          throw new AppError('INVENTORY_INSUFFICIENT', 409, 'Số lượng điều chỉnh làm tồn kho âm.', {
            currentStock: stock,
            requestedDelta: input.delta,
          });
        }
        const moved = await client.query<{ id: string }>(
          `INSERT INTO inventory_movements (variant_id, delta, reason, reference, note) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
          [input.variantId, input.delta, input.reason, `admin:${actor.userId}`, input.note ?? null],
        );
        await this.audit.record(
          {
            actorId: actor.userId,
            action: 'inventory.adjust',
            targetType: 'variant',
            targetId: input.variantId,
            metadata: {
              sku: variant.rows[0].sku,
              delta: input.delta,
              reason: input.reason,
              note: input.note,
              before: stock,
              after: stock + input.delta,
            },
            requestId: actor.requestId,
          },
          client,
        );
        return {
          movementId: moved.rows[0]!.id,
          variantId: input.variantId,
          stock: stock + input.delta,
        };
      },
    );
  }

  async history(variantId: string) {
    const exists = await this.db.query('SELECT 1 FROM product_variants WHERE id = $1', [variantId]);
    if (!exists.rowCount) throw AppError.notFound('Không tìm thấy biến thể.');
    const [stock, rows] = await Promise.all([
      this.db.query<{ s: string }>(
        'SELECT COALESCE(SUM(delta),0) AS s FROM inventory_movements WHERE variant_id = $1',
        [variantId],
      ),
      this.db.query<{
        id: string;
        delta: number;
        reason: string;
        reference: string | null;
        note: string | null;
        created_at: Date;
      }>(
        'SELECT id, delta, reason, reference, note, created_at FROM inventory_movements WHERE variant_id = $1 ORDER BY created_at DESC, id LIMIT 50',
        [variantId],
      ),
    ]);
    return {
      stock: Number(stock.rows[0]!.s),
      movements: rows.rows.map((m) => ({
        id: m.id,
        delta: m.delta,
        reason: m.reason,
        reference: m.reference,
        note: m.note,
        createdAt: m.created_at.toISOString(),
      })),
    };
  }
}
