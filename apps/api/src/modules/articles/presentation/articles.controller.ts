import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { articleListQuerySchema } from '@nona/contracts';
import { parseInput } from '../../../common/http/parse';
import { ArticlesService } from '../application/articles.service';

@Controller('articles')
export class ArticlesController {
  constructor(@Inject(ArticlesService) private readonly articles: ArticlesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60')
  list(@Query() raw: Record<string, unknown>) {
    const q = parseInput(articleListQuerySchema, raw);
    return this.articles.listPublished(q.page, q.pageSize);
  }

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=0, s-maxage=15, stale-while-revalidate=60')
  detail(@Param('slug') slug: string) {
    return this.articles.published(slug.toLowerCase());
  }
}
