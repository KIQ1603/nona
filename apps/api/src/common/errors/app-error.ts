import type { ErrorCode } from '@nona/contracts';

/** Domain/application error with a stable code. The filter turns it into the API error contract. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }

  static notFound(message = 'Không tìm thấy nội dung yêu cầu.') {
    return new AppError('NOT_FOUND', 404, message);
  }
  static validation(details: Record<string, unknown>, message = 'Dữ liệu gửi lên không hợp lệ.') {
    return new AppError('VALIDATION_FAILED', 400, message, details);
  }
}
