import type { MetadataRoute } from 'next';
import { getArticles } from '@/features/articles/articles.api';
import { getCategories, getProducts } from '@/features/catalog/api/catalog.api';
import { shopHref } from '@/features/catalog/lib/shop-params';
import { SITE_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, firstPage, articles] = await Promise.all([
    getCategories(),
    getProducts({ pageSize: 48 }),
    getArticles(1, 24).catch(() => null),
  ]);
  const products = [...firstPage.items];
  for (let page = 2; page <= firstPage.meta.totalPages; page++) {
    products.push(...(await getProducts({ pageSize: 48, page })).items);
  }
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/shop`, changeFrequency: 'daily', priority: 0.9 },
    ...categories.items.map((c) => ({
      url: `${SITE_URL}${shopHref({ category: c.slug })}`,
      changeFrequency: 'weekly' as const,
      priority: 0.7,
    })),
    { url: `${SITE_URL}/bai-viet`, changeFrequency: 'weekly' as const, priority: 0.6 },
    ...(articles?.items ?? []).map((a) => ({
      url: `${SITE_URL}/bai-viet/${a.slug}`,
      lastModified: a.publishedAt,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
    })),
    ...products.map((p) => ({
      url: `${SITE_URL}/san-pham/${p.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
