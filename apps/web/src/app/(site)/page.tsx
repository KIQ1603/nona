import type { Metadata } from 'next';
import { getProducts } from '@/features/catalog/api/catalog.api';
import { LandingExperience } from '@/features/landing/landing-experience';

export const metadata: Metadata = { alternates: { canonical: '/' } };

/** Giới thiệu: the public landing page, inside the same shell (header, footer) as the rest of the shop. */
export default async function HomePage() {
  const featured = await getProducts({ featured: 'true', sort: 'featured', pageSize: 3 });
  // nothing flagged as featured yet: fall back to the first products rather than an empty block
  const products =
    featured.items.length > 0
      ? featured.items
      : (await getProducts({ sort: 'featured', pageSize: 3 })).items;
  return <LandingExperience products={products.slice(0, 3)} />;
}
