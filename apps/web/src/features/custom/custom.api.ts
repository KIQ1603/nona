import { customCatalogSchema } from '@nona/contracts';
import { apiGet } from '@/lib/api-client';

export const getCustomCatalog = () =>
  apiGet('/custom/catalog', customCatalogSchema, { revalidate: 10, tags: ['settings', 'catalog'] });
