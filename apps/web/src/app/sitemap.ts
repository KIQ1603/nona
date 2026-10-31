import type { MetadataRoute } from 'next';
import { getCategories, getProducts } from '@/features/catalog/api/catalog.api';
import { SITE_URL } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [categories, firstPage] = await Promise.all([
    getCategories(),
    getProducts({ pageSize: 48 }),
  ]);
  const products = [...firstPage.items];
  for (let page = 2; page <= firstPage.meta.totalPages; page++) {
    products.push(...(await getProducts({ pageSize: 48, page })).items);
  }
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/trang-chu`, changeFrequency: 'weekly', priority: 0.9 },
    // each product type has its own page; groups inside a type are sections of that page
    ...categories.items
      .filter((c) => c.parentSlug === null)
      .map((c) => ({
        url: `${SITE_URL}/shop/${c.slug}`,
        changeFrequency: 'daily' as const,
        priority: 0.9,
      })),
    ...products.map((p) => ({
      url: `${SITE_URL}/san-pham/${p.slug}`,
      changeFrequency: 'weekly' as const,
      priority: 0.8,
    })),
  ];
}
