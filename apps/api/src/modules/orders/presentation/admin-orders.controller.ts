import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  adminOrderListQuerySchema,
  refundRequestSchema,
  resolveRefundSchema,
  updateOrderStatusSchema,
} from '@nona/contracts';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { AdminOrdersService } from '../application/admin-orders.service';

const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });

@Controller('admin')
export class AdminOrdersController {
  constructor(@Inject(AdminOrdersService) private readonly orders: AdminOrdersService) {}

  @Get('orders')
  @RequirePermission('orders:read')
  list(@Query() raw: Record<string, unknown>) {
    const q = parseInput(adminOrderListQuerySchema, raw);
    return this.orders.list({ q: q.q, status: q.status }, q.page, q.pageSize);
  }

  @Get('orders/:id')
  @RequirePermission('orders:read')
  get(@Param('id', uuid) id: string) {
    return this.orders.get(id);
  }

  @Patch('orders/:id/status')
  @RequirePermission('orders:write')
  changeStatus(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    return this.orders.changeStatus(id, parseInput(updateOrderStatusSchema, body), {
      userId: auth.userId,
      requestId,
    });
  }

  @Post('orders/:id/refunds')
  @RequirePermission('refunds:write')
  @HttpCode(201)
  requestRefund(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @Headers('idempotency-key') rawKey: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    const key = IdempotencyService.requireKey(rawKey);
    return this.orders.requestRefund(id, parseInput(refundRequestSchema, body), key, {
      userId: auth.userId,
      requestId,
    });
  }

  @Post('refunds/:id/resolve')
  @RequirePermission('refunds:write')
  @HttpCode(200)
  resolveRefund(
    @Param('id', uuid) id: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    const { outcome, note } = parseInput(resolveRefundSchema, body);
    return this.orders.resolveRefund(id, outcome, note, { userId: auth.userId, requestId });
  }
}
