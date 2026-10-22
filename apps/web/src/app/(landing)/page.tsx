import type { Metadata } from 'next';
import { getProduct, getProducts } from '@/features/catalog/api/catalog.api';
import { getLanding } from '@/features/landing/landing.api';
import { LandingExperience } from '@/features/landing/landing-experience';
import { getStorefrontSettings } from '@/features/settings/settings.api';

export const metadata: Metadata = { alternates: { canonical: '/' } };

export default async function HomePage() {
  const [content, settings, featured] = await Promise.all([
    getLanding(),
    getStorefrontSettings(),
    getProducts({ sort: 'featured', pageSize: 4 }),
  ]);
  const detailed = await Promise.all(featured.items.slice(0, 4).map((p) => getProduct(p.slug)));
  const products = detailed.filter((p): p is NonNullable<typeof p> => p !== null);
  return (
    <LandingExperience
      content={content}
      products={products}
      contact={settings.contact}
      freeShippingThresholdVnd={settings.freeShippingThresholdVnd}
    />
  );
}
