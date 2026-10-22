import { Body, Controller, Get, Header, Inject, Param, Patch } from '@nestjs/common';
import { updateSettingSchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { parseInput } from '../../../common/http/parse';
import { SettingsService } from '../application/settings.service';

@Controller()
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @Get('storefront/settings')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60')
  storefront() {
    return this.settings.getStorefront();
  }

  @Get('storefront/landing')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60')
  landing() {
    return this.settings.getLanding();
  }

  @Get('admin/settings')
  @RequirePermission('admin:access')
  admin() {
    return this.settings.getAdmin();
  }

  @Patch('admin/settings/:key')
  @RequirePermission('settings:write')
  update(
    @Param('key') key: string,
    @Body() body: unknown,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    const { version, value } = parseInput(updateSettingSchema, body);
    return this.settings.update(key, version, value, auth.userId, requestId);
  }
}
