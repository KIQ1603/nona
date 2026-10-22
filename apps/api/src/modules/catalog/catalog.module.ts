import { Module } from '@nestjs/common';
import { CatalogService } from './application/catalog.service';
import { CATALOG_REPOSITORY } from './domain/catalog.types';
import { SqlCatalogRepository } from './infrastructure/sql-catalog.repository';
import { CatalogController } from './presentation/catalog.controller';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, { provide: CATALOG_REPOSITORY, useClass: SqlCatalogRepository }],
  exports: [CatalogService],
})
export class CatalogModule {}
