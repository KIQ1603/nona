import { Module } from '@nestjs/common';
import { AdminCatalogService } from './application/admin-catalog.service';
import { AdminCatalogRepository } from './infrastructure/admin-catalog.repository';
import { AdminCatalogController } from './presentation/admin-catalog.controller';

@Module({
  controllers: [AdminCatalogController],
  providers: [AdminCatalogService, AdminCatalogRepository],
})
export class AdminCatalogModule {}
