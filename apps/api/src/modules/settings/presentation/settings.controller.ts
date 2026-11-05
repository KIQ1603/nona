import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Header,
  Inject,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { updateSettingSchema } from '@nona/contracts';
import type { AuthContext } from '../../../common/auth/auth.types';
import { CurrentAuth, RequestId, RequirePermission } from '../../../common/auth/decorators';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { ENV, type Env } from '../../../config/env';
import { AuditService } from '../../audit/application/audit.service';
import { ImageProcessor } from '../../media/application/image-processor';
import { OBJECT_STORAGE, type ObjectStorage } from '../../media/domain';
import { SettingsService } from '../application/settings.service';

@Controller()
export class SettingsController {
  private readonly mediaBase: string;
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ImageProcessor) private readonly images: ImageProcessor,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.mediaBase = env.MEDIA_BASE_URL.replace(/\/$/, '');
  }

  /** Pictures of Trang chủ / Giới thiệu chosen in the admin (null = the page uses its built-in picture). */
  @Get('storefront/pages')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60')
  pages() {
    return this.settings.getPageImages(this.mediaBase);
  }

  /** Stores a page picture; the admin then saves the returned key in the `pages` setting. */
  @Post('admin/pages/image')
  @RequirePermission('settings:write')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 2 } }),
  )
  async uploadPageImage(
    @UploadedFile() file: { buffer: Buffer } | undefined,
    @CurrentAuth() auth: AuthContext,
    @RequestId() requestId?: string,
  ) {
    if (!file) throw new AppError('MEDIA_INVALID', 400, 'Chưa chọn tệp ảnh.');
    const img = await this.images.process(file.buffer, { minSide: 300, maxSide: 1600 });
    const imageKey = `pages/${randomUUID()}.webp`;
    await this.storage.put(imageKey, img.body, img.contentType);
    await this.audit.record({
      actorId: auth.userId,
      action: 'pages.image_upload',
      targetType: 'setting',
      targetId: 'pages',
      metadata: { imageKey },
      requestId,
    });
    return {
      imageKey,
      imageUrl: `${this.mediaBase}/${imageKey}`,
      width: img.width,
      height: img.height,
    };
  }

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
