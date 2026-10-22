import { articleListSchema, articleSchema } from '@nona/contracts';
import { ApiError, apiGet } from '@/lib/api-client';

export const getArticles = (page = 1, pageSize = 9) =>
  apiGet(`/articles?page=${page}&pageSize=${pageSize}`, articleListSchema, { tags: ['articles'] });

/** null for unknown or unpublished posts so pages can call notFound(). */
export async function getArticle(slug: string) {
  try {
    return await apiGet(`/articles/${encodeURIComponent(slug)}`, articleSchema, {
      tags: ['articles'],
    });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}
