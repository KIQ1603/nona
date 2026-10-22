import { Inject, Injectable } from '@nestjs/common';
import { MAX_ADDRESSES, type AddressDto } from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../platform/database/database.service';

interface Row {
  id: string;
  full_name: string;
  phone: string;
  line1: string;
  ward: string;
  district: string;
  province: string;
  is_default: boolean;
}
const toDto = (r: Row): AddressDto => ({
  id: r.id,
  fullName: r.full_name,
  phone: r.phone,
  line1: r.line1,
  ward: r.ward,
  district: r.district,
  province: r.province,
  isDefault: r.is_default,
});
const COLUMNS: Record<string, string> = {
  fullName: 'full_name',
  phone: 'phone',
  line1: 'line1',
  ward: 'ward',
  district: 'district',
  province: 'province',
};

@Injectable()
export class AddressesService {
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async list(userId: string) {
    const { rows } = await this.db.query<Row>(
      'SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC',
      [userId],
    );
    return { items: rows.map(toDto) };
  }

  /** Every mutation is scoped by user_id, so one customer can never read or change another's address. */
  async create(userId: string, input: { isDefault: boolean } & Record<string, unknown>) {
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]); // serialize per user
      const count = Number(
        (await c.query('SELECT COUNT(*) AS n FROM addresses WHERE user_id = $1', [userId])).rows[0]
          .n,
      );
      if (count >= MAX_ADDRESSES)
        throw new AppError('CONFLICT', 409, `Bạn chỉ có thể lưu tối đa ${MAX_ADDRESSES} địa chỉ.`);
      const makeDefault = input.isDefault || count === 0;
      if (makeDefault)
        await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
      await c.query(
        `INSERT INTO addresses (user_id, full_name, phone, line1, ward, district, province, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          userId,
          input.fullName,
          input.phone,
          input.line1,
          input.ward,
          input.district,
          input.province,
          makeDefault,
        ],
      );
    });
    return this.list(userId);
  }

  async update(userId: string, id: string, input: Record<string, unknown>) {
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const existing = (
        await c.query(
          'SELECT is_default FROM addresses WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [id, userId],
        )
      ).rows[0];
      if (!existing) throw AppError.notFound('Không tìm thấy địa chỉ.');
      if (input.isDefault === true)
        await c.query('UPDATE addresses SET is_default = false WHERE user_id = $1', [userId]);
      const sets: string[] = [];
      const values: unknown[] = [id, userId];
      for (const [key, value] of Object.entries(input)) {
        const col = COLUMNS[key];
        if (col && value !== undefined) {
          values.push(value);
          sets.push(`${col} = $${values.length}`);
        }
      }
      if (input.isDefault === true) sets.push('is_default = true');
      if (input.isDefault === false && existing.is_default) {
        throw new AppError(
          'CONFLICT',
          409,
          'Hãy chọn một địa chỉ khác làm mặc định thay vì bỏ mặc định.',
        );
      }
      if (sets.length)
        await c.query(
          `UPDATE addresses SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`,
          values,
        );
    });
    return this.list(userId);
  }

  async remove(userId: string, id: string) {
    await this.db.transaction(async (c) => {
      await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const res = await c.query(
        'DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING is_default',
        [id, userId],
      );
      if (res.rowCount !== 1) throw AppError.notFound('Không tìm thấy địa chỉ.');
      if (res.rows[0].is_default) {
        await c.query(
          'UPDATE addresses SET is_default = true WHERE id = (SELECT id FROM addresses WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)',
          [userId],
        );
      }
    });
    return this.list(userId);
  }
}
