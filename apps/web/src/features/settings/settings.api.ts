import { storefrontSettingsSchema, type StorefrontSettings } from '@nona/contracts';
import { apiGet } from '@/lib/api-client';

const FALLBACK: StorefrontSettings = {
  announcement: { enabled: false, text: '', linkUrl: null },
  freeShippingThresholdVnd: null,
  flatShippingFeeVnd: 0,
  contact: {
    floatingEnabled: false,
    headline: 'Liên hệ NONA',
    description: '',
    address: '',
    hours: '',
    channels: [],
  },
};

/** Settings must never take the storefront down: on any failure, show no announcement. */
export async function getStorefrontSettings(): Promise<StorefrontSettings> {
  try {
    return await apiGet('/storefront/settings', storefrontSettingsSchema, {
      tags: ['settings'],
      revalidate: 15,
    });
  } catch {
    return FALLBACK;
  }
}
