import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import { inventoryAdjustmentSchema } from '@nona/contracts';
import type { Response } from 'express';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { InventoryService } from '../application/inventory.service';

@Controller('admin')
export class InventoryController {
  constructor(@Inject(InventoryService) private readonly inventory: InventoryService) {}

  @Post('inventory/adjustments')
  @RequirePermission('inventory:write')
  async adjust(
    @Body() body: unknown,
    @Headers('idempotency-key') key: string | undefined,
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) res: Response,
    @RequestId() requestId?: string,
  ) {
    const idempotencyKey = IdempotencyService.requireKey(key);
    const result = await this.inventory.adjust(
      { userId: auth.userId, requestId },
      idempotencyKey,
      parseInput(inventoryAdjustmentSchema, body),
    );
    res.status(result.status);
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  @Get('variants/:id/inventory')
  @RequirePermission('admin:access')
  history(
    @Param('id', new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() }))
    id: string,
  ) {
    return this.inventory.history(id);
  }
}
