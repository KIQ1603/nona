import { Controller, Get, Inject, Query } from '@nestjs/common';
import { z } from 'zod';
import { RequirePermission } from '../../../common/auth/decorators';
import { parseInput } from '../../../common/http/parse';
import { AuditService } from '../application/audit.service';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

@Controller('admin/audit-logs')
export class AuditController {
  constructor(@Inject(AuditService) private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('audit:read')
  list(@Query() raw: Record<string, unknown>) {
    const q = parseInput(querySchema, raw);
    return this.audit.list(q.page, q.pageSize);
  }
}
