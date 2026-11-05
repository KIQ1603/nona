import { pageImagesSchema, type PageImages } from '@nona/contracts';
import { apiGet } from '@/lib/api-client';

const EMPTY: PageImages = { homeTypes: {}, homeAbout: null, aboutGallery: [], aboutValues: [] };

/** Pictures the admin chose for Trang chủ / Giới thiệu. On any failure every page uses its built-in pictures. */
export async function getPageImages(): Promise<PageImages> {
  try {
    return await apiGet('/storefront/pages', pageImagesSchema, {
      tags: ['settings'],
      revalidate: 15,
    });
  } catch {
    return EMPTY;
  }
}
