import { Controller, Get, Inject } from '@nestjs/common';
import { RequirePermission } from '../../../common/auth/decorators';
import { DashboardService } from '../application/dashboard.service';

@Controller('admin/dashboard')
export class DashboardController {
  constructor(@Inject(DashboardService) private readonly dashboard: DashboardService) {}

  @Get()
  @RequirePermission('orders:read')
  overview() {
    return this.dashboard.overview();
  }
}
