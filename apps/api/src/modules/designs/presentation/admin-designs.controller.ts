import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { adminDesignListQuerySchema, reviewDesignSchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { AdminDesignsService } from '../application/admin-designs.service';

const uuid = new ParseUUIDPipe({ version: '4', exceptionFactory: () => AppError.notFound() });

@Controller('admin/designs')
export class AdminDesignsController {
  constructor(@Inject(AdminDesignsService) private readonly designs: AdminDesignsService) {}

  @Get()
  @RequirePermission('designs:read')
  list(@Query() raw: Record<string, unknown>) {
    const q = parseInput(adminDesignListQuerySchema, raw);
    return this.designs.list({ status: q.status, q: q.q }, q.page, q.pageSize);
  }

  @Get(':id')
  @RequirePermission('designs:read')
  detail(@Param('id', uuid) id: string, @Query('versionId') versionId?: string) {
    return this.designs.detail(
      id,
      versionId && /^[0-9a-f-]{36}$/.test(versionId) ? versionId : undefined,
    );
  }

  @Post('versions/:versionId/review')
  @RequirePermission('designs:review')
  @HttpCode(200)
  review(
    @Param('versionId', uuid) versionId: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    return this.designs.review(versionId, parseInput(reviewDesignSchema, body), {
      userId: auth.userId,
      requestId,
    });
  }
}
