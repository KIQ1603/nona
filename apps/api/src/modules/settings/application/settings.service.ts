import { Inject, Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  SETTING_SCHEMAS,
  type AdminSettings,
  type CustomOptions,
  type LandingContent,
  type SettingKey,
  type StorefrontSettings,
} from '@nona/contracts';
import { AppError } from '../../../common/errors/app-error';
import { parseInput } from '../../../common/http/parse';
import { DatabaseService } from '../../../platform/database/database.service';
import { AuditService } from '../../audit/application/audit.service';

const DEFAULTS = {
  announcement: { enabled: false, text: '', linkUrl: null },
  shipping: { freeShippingThresholdVnd: null, flatFeeVnd: 0, zones: [] },
  checkout: { paymentWindowMinutes: 30, requirePhoneVerification: true },
  contact: {
    floatingEnabled: true,
    headline: 'Liên hệ NONA',
    description: '',
    address: '',
    hours: '',
    channels: [],
  },
  landing: {
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
  },
  custom: {
    enabled: false,
    requireApproval: false,
    maxLayers: 6,
    allowText: false,
    allowImage: false,
    maxTextLength: 30,
    textPriceVnd: 0,
    imagePriceVnd: 0,
    colors: [{ id: 'natural', name: 'Tự nhiên', hex: '#d5bd84', priceVnd: 0 }],
    inks: [{ id: 'black', name: 'Đen', hex: '#242a27' }],
    motifs: [],
  },
} as const;

/** Object schemas reject unknown fields; the custom-options schema is already strict (and refined). */
const strictly = (schema: unknown): z.ZodTypeAny => {
  const s = schema as { strict?: () => z.ZodTypeAny };
  return s.strict ? s.strict() : (schema as z.ZodTypeAny);
};

interface Row {
  key: string;
  value: Record<string, unknown>;
  version: number;
}

/** Business configuration that admins own. Backend rules read from here, never from constants. */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DatabaseService) private readonly db: DatabaseService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async rows(): Promise<Map<string, Row>> {
    const { rows } = await this.db.query<Row>('SELECT key, value, version FROM site_settings');
    return new Map(rows.map((r) => [r.key, r]));
  }

  /** Public view. Invalid/missing stored values degrade to "off" rather than breaking the storefront. */
  async getStorefront(): Promise<StorefrontSettings> {
    const rows = await this.rows();
    const announcement = SETTING_SCHEMAS.announcement.safeParse(rows.get('announcement')?.value);
    const shipping = SETTING_SCHEMAS.shipping.safeParse(rows.get('shipping')?.value);
    const contact = SETTING_SCHEMAS.contact.safeParse(rows.get('contact')?.value);
    return {
      contact: contact.success ? contact.data : { ...DEFAULTS.contact, channels: [] },
      announcement:
        announcement.success && announcement.data.text
          ? announcement.data
          : { ...DEFAULTS.announcement },
      freeShippingThresholdVnd: shipping.success ? shipping.data.freeShippingThresholdVnd : null,
      flatShippingFeeVnd: shipping.success ? shipping.data.flatFeeVnd : 0,
    };
  }

  /** Content of the brand landing page; falls back to an empty skeleton so the storefront never breaks. */
  async getLanding(): Promise<LandingContent> {
    const rows = await this.rows();
    const parsed = SETTING_SCHEMAS.landing.safeParse(rows.get('landing')?.value);
    return parsed.success ? parsed.data : (DEFAULTS.landing as unknown as LandingContent);
  }

  /**
   * Shipping rules used to price orders. Unlike the storefront view this must NOT fall back silently:
   * charging the wrong fee is worse than refusing to quote, so invalid configuration is an error.
   */
  async getShippingRules(client?: {
    query: (t: string, v?: unknown[]) => Promise<{ rows: { value: unknown }[] }>;
  }) {
    const q = client ?? this.db;
    const { rows } = await q.query("SELECT value FROM site_settings WHERE key = 'shipping'");
    const parsed = SETTING_SCHEMAS.shipping.safeParse(rows[0]?.value);
    if (!parsed.success) {
      throw new AppError(
        'INTERNAL_ERROR',
        500,
        'Cấu hình phí vận chuyển chưa hợp lệ. Vui lòng liên hệ cửa hàng.',
      );
    }
    return {
      freeThresholdVnd: parsed.data.freeShippingThresholdVnd,
      flatFeeVnd: parsed.data.flatFeeVnd,
      zones: parsed.data.zones,
    };
  }

  /** Customisation catalogue and prices. Invalid configuration must not silently reprice designs, so it is an error. */
  async getCustomOptions(client?: {
    query: (t: string, v?: unknown[]) => Promise<{ rows: { value: unknown }[] }>;
  }): Promise<CustomOptions> {
    const q = client ?? this.db;
    const { rows } = await q.query("SELECT value FROM site_settings WHERE key = 'custom'");
    const parsed = SETTING_SCHEMAS.custom.safeParse(rows[0]?.value);
    if (!parsed.success)
      throw new AppError(
        'INTERNAL_ERROR',
        500,
        'Cấu hình thiết kế riêng chưa hợp lệ. Vui lòng liên hệ cửa hàng.',
      );
    return parsed.data;
  }

  /** Online-payment hold window. Misconfiguration must not silently shorten or lengthen stock holds. */
  async getCheckoutRules(client?: {
    query: (t: string, v?: unknown[]) => Promise<{ rows: { value: unknown }[] }>;
  }) {
    const q = client ?? this.db;
    const { rows } = await q.query("SELECT value FROM site_settings WHERE key = 'checkout'");
    const parsed = SETTING_SCHEMAS.checkout.safeParse(rows[0]?.value);
    if (!parsed.success)
      throw new AppError(
        'INTERNAL_ERROR',
        500,
        'Cấu hình thanh toán chưa hợp lệ. Vui lòng liên hệ cửa hàng.',
      );
    return {
      paymentWindowMinutes: parsed.data.paymentWindowMinutes,
      requirePhoneVerification: parsed.data.requirePhoneVerification,
    };
  }

  async getAdmin(): Promise<AdminSettings> {
    const rows = await this.rows();
    const pick = <K extends SettingKey>(key: K) => {
      const row = rows.get(key);
      const parsed = SETTING_SCHEMAS[key].safeParse(row?.value);
      return { ...(parsed.success ? parsed.data : DEFAULTS[key]), version: row?.version ?? 0 };
    };
    return {
      announcement: pick('announcement') as AdminSettings['announcement'],
      shipping: pick('shipping') as AdminSettings['shipping'],
      checkout: pick('checkout') as AdminSettings['checkout'],
      custom: pick('custom') as AdminSettings['custom'],
      contact: pick('contact') as AdminSettings['contact'],
      landing: pick('landing') as AdminSettings['landing'],
    };
  }

  async update(
    key: string,
    version: number,
    rawValue: unknown,
    actorId: string,
    requestId?: string,
  ) {
    if (!(key in SETTING_SCHEMAS)) throw AppError.notFound('Không tìm thấy cấu hình.');
    const settingKey = key as SettingKey;
    const value = parseInput(strictly(SETTING_SCHEMAS[settingKey]), rawValue);

    await this.db.transaction(async (client) => {
      const before = await client.query<{ value: unknown }>(
        'SELECT value FROM site_settings WHERE key = $1 FOR UPDATE',
        [settingKey],
      );
      const updated = await client.query(
        `UPDATE site_settings SET value = $1::jsonb, version = version + 1, updated_by = $2, updated_at = now()
         WHERE key = $3 AND version = $4`,
        [JSON.stringify(value), actorId, settingKey, version],
      );
      if (updated.rowCount !== 1) {
        throw new AppError(
          'CONFLICT',
          409,
          'Cấu hình đã được người khác thay đổi. Vui lòng tải lại.',
        );
      }
      await this.audit.record(
        {
          actorId,
          action: 'settings.update',
          targetType: 'setting',
          targetId: settingKey,
          metadata: { before: before.rows[0]?.value, after: value },
          requestId,
        },
        client,
      );
    });
    return this.getAdmin();
  }
}
