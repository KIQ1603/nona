import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logging/logger';

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Assigns/propagates a request id and writes one structured access log per request. */
export function requestContext(
  req: Request & { id?: string },
  res: Response,
  next: NextFunction,
): void {
  const incoming = req.header('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`;
  res.setHeader('x-request-id', req.id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    logger.info(
      {
        requestId: req.id,
        operation: `${req.method} ${req.route?.path ?? req.path}`,
        status: res.statusCode,
        durationMs: Number((process.hrtime.bigint() - started) / 1_000_000n),
      },
      'request',
    );
  });
  next();
}
