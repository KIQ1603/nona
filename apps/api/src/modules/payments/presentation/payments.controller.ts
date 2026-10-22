import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { initiatePaymentSchema } from '@nona/contracts';
import type { Request, Response } from 'express';
import { parseInput } from '../../../common/http/parse';
import { IdempotencyService } from '../../../common/idempotency/idempotency.service';
import { normalizeOrderCode } from '../../orders/domain/order-code';
import { AppError } from '../../../common/errors/app-error';
import { PaymentsService } from '../application/payments.service';
import { SettlementService } from '../application/settlement.service';
import { SystemService } from '../application/system.service';
import { InternalGuard } from './internal.guard';

const asStrings = (raw: unknown): Record<string, string | undefined> => {
  const out: Record<string, string | undefined> = {};
  if (raw && typeof raw === 'object')
    for (const [k, v] of Object.entries(raw)) if (typeof v === 'string') out[k] = v;
  return out;
};

@Controller()
export class PaymentsController {
  constructor(
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(SettlementService) private readonly settlement: SettlementService,
    @Inject(SystemService) private readonly system: SystemService,
  ) {}

  /** Starts (or restarts) online payment for an unpaid order. */
  @Post('payments/vnpay')
  @HttpCode(200)
  async initiate(
    @Body() body: unknown,
    @Headers('idempotency-key') rawKey: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = IdempotencyService.requireKey(rawKey);
    const code = normalizeOrderCode(parseInput(initiatePaymentSchema, body).orderCode);
    if (!code) throw AppError.notFound('Không tìm thấy đơn hàng.');
    const result = await this.payments.initiate(code, key, req.ip);
    res.setHeader('Cache-Control', 'no-store');
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result.body;
  }

  /**
   * Provider webhook (IPN). VNPay calls it with GET; POST is accepted too. Always answers 200 with the
   * provider's acknowledgement JSON. Duplicates are acknowledged (RspCode 02) and have no further effect.
   */
  @Get('webhooks/payments/vnpay')
  ipnGet(@Query() query: Record<string, unknown>) {
    return this.settlement.handleIpn(asStrings(query));
  }

  @Post('webhooks/payments/vnpay')
  @HttpCode(200)
  ipnPost(@Query() query: Record<string, unknown>, @Body() body: Record<string, unknown>) {
    return this.settlement.handleIpn({ ...asStrings(query), ...asStrings(body) });
  }

  // ---- internal (worker / monitoring) ----
  @Post('internal/jobs/payments-maintenance')
  @UseGuards(InternalGuard)
  @HttpCode(200)
  async maintenance() {
    const reconcile = await this.settlement.reconcile();
    const expired = await this.settlement.expireUnpaid();
    const refundsSent = await this.settlement.retryPendingRefunds();
    return { reconcile, expired, refundsSent };
  }

  @Get('internal/metrics')
  @UseGuards(InternalGuard)
  async metrics(@Res() res: Response) {
    res.type('text/plain; version=0.0.4').send(await this.system.metrics());
  }
}
