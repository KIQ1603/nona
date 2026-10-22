import { Module } from '@nestjs/common';
import { ArticlesService } from './application/articles.service';
import { ArticlesRepository } from './infrastructure/articles.repository';
import { AdminArticlesController } from './presentation/admin-articles.controller';
import { ArticlesController } from './presentation/articles.controller';

@Module({
  controllers: [ArticlesController, AdminArticlesController],
  providers: [ArticlesService, ArticlesRepository],
})
export class ArticlesModule {}
