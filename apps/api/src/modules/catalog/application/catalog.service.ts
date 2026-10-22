import { Inject, Injectable } from '@nestjs/common';
import type {
  CategoryListResponse,
  ProductDetail,
  ProductListQuery,
  ProductListResponse,
} from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { ENV, type Env } from '../../../config/env';
import { CATALOG_REPOSITORY, type CatalogRepository } from '../domain/catalog.types';
import { toDetail, toListItem } from './catalog.mapper';

/** Read-only catalog use cases. */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(CATALOG_REPOSITORY) private readonly repo: CatalogRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async listCategories(): Promise<CategoryListResponse> {
    return { items: await this.repo.listCategories() };
  }

  async listProducts(query: ProductListQuery): Promise<ProductListResponse> {
    const page = await this.repo.listProducts(query);
    return {
      items: page.records.map((r) => toListItem(r, this.env.MEDIA_BASE_URL)),
      meta: {
        page: query.page,
        pageSize: query.pageSize,
        total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize),
      },
      facets: { priceMinVnd: page.priceMinVnd, priceMaxVnd: page.priceMaxVnd },
    };
  }

  async getProduct(slug: string): Promise<ProductDetail> {
    const record = await this.repo.findProductBySlug(slug);
    if (!record) throw AppError.notFound('Không tìm thấy sản phẩm.');
    return toDetail(record, this.env.MEDIA_BASE_URL);
  }
}
