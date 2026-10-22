import { AppError } from './app-error';

/** Maps well-known PostgreSQL constraint violations to stable API conflicts. Re-throws anything else. */
export function mapDbError(error: unknown, uniqueMessages: Record<string, string> = {}): never {
  const e = error as { code?: string; constraint?: string };
  if (e?.code === '23505') {
    const message = (e.constraint && uniqueMessages[e.constraint]) || 'Giá trị này đã tồn tại.';
    throw new AppError('CONFLICT', 409, message, { constraint: e.constraint });
  }
  if (e?.code === '23503') {
    throw new AppError('CONFLICT', 409, 'Dữ liệu đang được sử dụng ở nơi khác.', {
      constraint: e.constraint,
    });
  }
  throw error;
}
