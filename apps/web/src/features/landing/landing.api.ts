import { landingSettingSchema, type LandingContent } from '@nona/contracts';
import { apiGet } from '@/lib/api-client';

const EMPTY: LandingContent = {
  hero: {
    eyebrow: '',
    titleTop: 'NONA',
    titleAccent: 'Nón Việt',
    text: '',
    primaryCta: 'Khám phá bộ sưu tập',
    secondaryCta: 'Câu chuyện',
  },
  story: {
    eyebrow: 'Câu chuyện',
    title: { before: '', accent: '', after: '' },
    text: '',
    bigWord: '',
    badgeText: '',
    imageUrl: null,
    imageAlt: '',
    stats: [],
  },
  process: { eyebrow: 'Quy trình', title: { before: '', accent: '', after: '' }, steps: [] },
  testimonials: { eyebrow: 'Khách hàng nói gì', items: [] },
  order: { eyebrow: 'Đặt hàng', titleTop: '', titleAccent: '', titleBottom: '', text: '' },
};

/** The landing must render even if the content service is down. */
export async function getLanding(): Promise<LandingContent> {
  try {
    return await apiGet('/storefront/landing', landingSettingSchema, {
      tags: ['settings'],
      revalidate: 15,
    });
  } catch {
    return EMPTY;
  }
}
