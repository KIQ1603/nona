import {
  availabilityFromQuantity,
  type ProductDetail,
  type ProductListItem,
} from '@nona/contracts';
import type { ImageRecord, ProductDetailRecord, ProductListRecord } from '../domain/catalog.types';

export const imageDto = (mediaBaseUrl: string) => (image: ImageRecord) => ({
  url: `${mediaBaseUrl.replace(/\/$/, '')}/${image.objectKey}`,
  alt: image.alt,
  width: image.width,
  height: image.height,
  variantId: image.variantId ?? null,
});

export function toListItem(r: ProductListRecord, mediaBaseUrl: string): ProductListItem {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    summary: r.summary,
    category: { slug: r.categorySlug, name: r.categoryName },
    badge: r.badge,
    colorCode: r.colorCode,
    styleCode: r.styleCode,
    priceVnd: r.minPriceVnd,
    compareAtPriceVnd: r.compareAtPriceVnd,
    hasMultiplePrices: r.maxPriceVnd > r.minPriceVnd,
    variantCount: r.variantCount,
    defaultVariantId: r.defaultVariantId,
    availability: availabilityFromQuantity(r.availableQuantity),
    image: r.image ? imageDto(mediaBaseUrl)(r.image) : null,
  };
}

export function toDetail(r: ProductDetailRecord, mediaBaseUrl: string): ProductDetail {
  const toImage = imageDto(mediaBaseUrl);
  return {
    ...toListItem(r, mediaBaseUrl),
    description: r.description,
    seoTitle: r.seoTitle,
    seoDescription: r.seoDescription,
    images: r.images.map(toImage),
    variants: r.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      priceVnd: v.priceVnd,
      compareAtPriceVnd: v.compareAtPriceVnd,
      availability: availabilityFromQuantity(v.availableQuantity),
    })),
  };
}
