import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';

/** Service-to-service calls (worker, monitoring). With no INTERNAL_API_TOKEN configured the routes do not exist. */
@Injectable()
export class InternalGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.env.INTERNAL_API_TOKEN;
    if (!expected) throw AppError.notFound();
    const got = context.switchToHttp().getRequest<Request>().header('x-internal-token') ?? '';
    const a = Buffer.from(got);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw AppError.notFound(); // do not reveal the route
    return true;
  }
}
