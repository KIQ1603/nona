import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AdminDesignsService } from './application/admin-designs.service';
import { CustomAssetsService } from './application/custom-assets.service';
import { DesignsService } from './application/designs.service';
import { DesignsRepository } from './infrastructure/designs.repository';
import { PreviewRenderer } from './infrastructure/preview-renderer';
import { AdminDesignsController } from './presentation/admin-designs.controller';
import { CustomAssetsController } from './presentation/custom-assets.controller';
import { DesignsController } from './presentation/designs.controller';

@Module({
  imports: [SettingsModule],
  controllers: [DesignsController, AdminDesignsController, CustomAssetsController],
  providers: [
    DesignsService,
    AdminDesignsService,
    CustomAssetsService,
    DesignsRepository,
    PreviewRenderer,
  ],
  exports: [DesignsService],
})
export class DesignsModule {}
