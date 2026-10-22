import type { ProductDetail } from '@nona/contracts';
import { SITE_URL } from '@/lib/env';

const AVAILABILITY = {
  IN_STOCK: 'https://schema.org/InStock',
  LOW_STOCK: 'https://schema.org/LimitedAvailability',
  OUT_OF_STOCK: 'https://schema.org/OutOfStock',
} as const;

export function productJsonLd(product: ProductDetail) {
  const url = `${SITE_URL}/san-pham/${product.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    description: product.description ?? product.summary ?? undefined,
    image: product.images.map((i) => i.url),
    sku: product.variants[0]?.sku,
    brand: { '@type': 'Brand', name: 'NONA' },
    offers: product.variants.map((v) => ({
      '@type': 'Offer',
      url,
      sku: v.sku,
      priceCurrency: 'VND',
      price: v.priceVnd,
      availability: AVAILABILITY[v.availability],
    })),
  };
}

/** JSON for an inline <script>: `<` is escaped so content can never close the tag. */
export const serializeJsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, '\\u003c');
