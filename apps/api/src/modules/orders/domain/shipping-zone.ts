import type { ShippingZone } from '@nona/contracts';

export interface ShippingRules {
  freeThresholdVnd: number | null;
  flatFeeVnd: number;
  zones: ShippingZone[];
}
export interface ResolvedShipping {
  freeThresholdVnd: number | null;
  flatFeeVnd: number;
  zoneName: string | null;
}

/** "TP. Hồ Chí Minh", "Thành phố Hồ Chí Minh" and "ho chi minh" must all match the same zone entry. */
export function normalizeProvince(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(thanh pho|tp|tinh)\s+/, '');
}

/**
 * Picks the shipping terms for a destination. The first zone listing the province wins; otherwise the
 * default terms apply. Unknown/empty province -> defaults. All values are admin-configured data.
 */
export function resolveShipping(rules: ShippingRules, province?: string | null): ResolvedShipping {
  const wanted = province ? normalizeProvince(province) : '';
  if (wanted) {
    const zone = rules.zones.find((z) => z.provinces.some((p) => normalizeProvince(p) === wanted));
    if (zone)
      return {
        freeThresholdVnd: zone.freeShippingThresholdVnd,
        flatFeeVnd: zone.flatFeeVnd,
        zoneName: zone.name,
      };
  }
  return { freeThresholdVnd: rules.freeThresholdVnd, flatFeeVnd: rules.flatFeeVnd, zoneName: null };
}
