import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { placeOrderSchema, quoteRequestSchema } from '@nona/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { AuthContext, RequestWithAuth } from '../../../common/auth/auth.types';
import { Authenticated, CurrentAuth, OptionalAuth } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { LoginThrottle } from '../../auth/infrastructure/login-throttle';
import { resolveOwner } from '../../cart/presentation/cart.controller';
import { OrdersService } from '../application/orders.service';
import { normalizeOrderCode } from '../domain/order-code';

type Req = Request & RequestWithAuth & { cookies?: Record<string, string> };
const listQuery = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});
const LOOKUP_LIMIT = 60; // lookups per IP per 15 minutes

@Controller()
export class OrdersController {
  constructor(
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(LoginThrottle) private readonly throttle: LoginThrottle,
  ) {}

  private code(raw: string): string {
    const code = normalizeOrderCode(raw);
    if (!code) throw AppError.notFound('Không tìm thấy đơn hàng.');
    return code;
  }

  @Post('checkout/quote')
  @OptionalAuth()
  @HttpCode(200)
  quote(@Body() body: unknown, @Req() req: Req, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    const { province, lineIds } = parseInput(quoteRequestSchema, body ?? {});
    return this.orders.quote(
      resolveOwner(req),
      { userId: req.auth?.userId, email: req.auth?.email },
      province,
      lineIds,
    );
  }

  @Post('orders')
  @OptionalAuth()
  async place(
    @Body() body: unknown,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = IdempotencyService.requireKey(rawKey);
    const input = parseInput(placeOrderSchema, body);
    const user = req.auth ? { id: req.auth.userId, email: req.auth.email } : null;
    const result = await this.orders.place(resolveOwner(req), user, key, input, req.ip);
    res.status(result.status).setHeader('Cache-Control', 'no-store');
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get('orders/:publicCode')
  @OptionalAuth()
  get(
    @Param('publicCode') raw: string,
    @Req() req: Req,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = `order-lookup|${req.ip ?? 'unknown'}`;
    if (this.throttle.isBlocked(key, LOOKUP_LIMIT))
      throw new AppError(
        'RATE_LIMITED',
        429,
        'Bạn tra cứu quá nhiều lần. Vui lòng thử lại sau ít phút.',
      );
    this.throttle.recordFailure(key);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    return this.orders.getByCode(this.code(raw), { userId: req.auth?.userId });
  }

  @Post('orders/:publicCode/cancel')
  @Authenticated()
  @HttpCode(200)
  cancel(@Param('publicCode') raw: string, @CurrentAuth() auth: AuthContext) {
    return this.orders.cancelOwn(this.code(raw), auth.userId);
  }

  @Get('me/orders')
  @Authenticated()
  mine(
    @Query() raw: Record<string, unknown>,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'no-store');
    const q = parseInput(listQuery, raw);
    return this.orders.listMine(auth.userId, q.page, q.pageSize);
  }
}
