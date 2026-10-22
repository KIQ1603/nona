import { Controller, Get, Inject } from '@nestjs/common';
import { RequirePermission } from '../../../common/auth/decorators';
import { SystemService } from '../application/system.service';

@Controller('admin/system')
export class SystemController {
  constructor(@Inject(SystemService) private readonly system: SystemService) {}

  /** Operational health for the admin "System" page: queues, payments, refunds and alerts. */
  @Get()
  @RequirePermission('system:read')
  status() {
    return this.system.status();
  }
}
