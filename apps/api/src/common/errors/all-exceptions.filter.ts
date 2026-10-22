import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@nona/contracts';
import type { Request, Response } from 'express';
import { logger } from '../logging/logger';
import { AppError } from './app-error';

const STATUS_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Single exit point for errors: stable code, Vietnamese message, request id, never a stack trace. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { id?: string }>();
    const requestId = req.id ?? 'req_unknown';

    let status = 500;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'Hệ thống đang gặp sự cố. Vui lòng thử lại sau.';
    let details: Record<string, unknown> = {};

    if (exception instanceof AppError) {
      ({ status, code, message, details } = exception);
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'INTERNAL_ERROR';
      message = status === 404 ? 'Không tìm thấy nội dung yêu cầu.' : 'Yêu cầu không hợp lệ.';
    } else {
      logger.error({ err: exception, requestId }, 'unhandled exception');
    }

    const body: ApiErrorBody = { error: { code, message, details, requestId } };
    res.status(status).json(body);
  }
}
