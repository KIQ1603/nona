import { Controller, Get, Header, Inject, Param, Query } from '@nestjs/common';
import { productListQuerySchema } from '@nona/contracts';
import { parseInput } from '../../../common/http/parse';
import { CatalogService } from '../application/catalog.service';

const PUBLIC_CACHE = 'public, max-age=0, s-maxage=15, stale-while-revalidate=60';

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private readonly catalog: CatalogService) {}

  @Get('categories')
  @Header('Cache-Control', PUBLIC_CACHE)
  categories() {
    return this.catalog.listCategories();
  }

  @Get('products')
  @Header('Cache-Control', PUBLIC_CACHE)
  products(@Query() rawQuery: Record<string, unknown>) {
    return this.catalog.listProducts(parseInput(productListQuerySchema, rawQuery));
  }

  @Get('products/:slug')
  @Header('Cache-Control', PUBLIC_CACHE)
  product(@Param('slug') slug: string) {
    return this.catalog.getProduct(slug);
  }
}
