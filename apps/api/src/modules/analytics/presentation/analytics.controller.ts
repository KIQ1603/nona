import { Controller, Get, HttpCode, Inject, Post, Query, Req, Body } from '@nestjs/common';
import { adminUserListQuerySchema, analyticsQuerySchema, trackEventSchema } from '@nona/contracts';
import type { Request } from 'express';
import { RequirePermission } from '../../../common/auth/decorators';
import { parseInput } from '../../../common/http/parse';
import { AnalyticsService } from '../application/analytics.service';

@Controller()
export class AnalyticsController {
  constructor(@Inject(AnalyticsService) private readonly analytics: AnalyticsService) {}

  /** Public, anonymous beacon from the storefront. Always 204 so tracking can never break a page. */
  @Post('analytics/events')
  @HttpCode(204)
  async track(@Body() body: unknown, @Req() req: Request): Promise<void> {
    await this.analytics.record(parseInput(trackEventSchema, body), req.ip);
  }

  @Get('admin/analytics')
  @RequirePermission('users:read')
  report(@Query() raw: Record<string, unknown>) {
    return this.analytics.report(parseInput(analyticsQuerySchema, raw).days);
  }

  @Get('admin/users')
  @RequirePermission('users:read')
  users(@Query() raw: Record<string, unknown>) {
    return this.analytics.users(parseInput(adminUserListQuerySchema, raw));
  }
}
