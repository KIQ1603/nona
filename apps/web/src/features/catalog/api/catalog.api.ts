import {
  categoryListResponseSchema,
  productDetailSchema,
  productListResponseSchema,
  type ProductListQuery,
} from '@nona/contracts';
import { ApiError, apiGet } from '@/lib/api-client';
import { toApiSearch } from '../lib/shop-params';

export const getCategories = () =>
  apiGet('/categories', categoryListResponseSchema, { tags: ['catalog'] });

export const getProducts = (query: Partial<ProductListQuery>) =>
  apiGet(`/products${toApiSearch(query)}`, productListResponseSchema, { tags: ['catalog'] });

/** Returns null for unknown/unpublished products so pages can call notFound(). */
export async function getProduct(slug: string) {
  try {
    return await apiGet(`/products/${encodeURIComponent(slug)}`, productDetailSchema, {
      tags: ['catalog'],
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
