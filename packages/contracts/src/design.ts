import { z } from 'zod';
import { bubbleGlyph } from './bubble-letters';
import { hatMarkup } from './hat-art';

// ---------------------------------------------------------------------------------------------
// NONA Custom: shared, pure definitions. The browser (live preview, price estimate) and the API
// (validation, authoritative price, stored preview) use the SAME functions, so they cannot drift.
// ---------------------------------------------------------------------------------------------

export const DESIGN_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REVISION_REQUIRED',
  'ARCHIVED',
] as const;
export type DesignStatus = (typeof DESIGN_STATUSES)[number];
export const DESIGN_STATUS_LABELS: Record<DesignStatus, string> = {
  DRAFT: 'Bản nháp',
  SUBMITTED: 'Đang chờ duyệt',
  APPROVED: 'Đã duyệt',
  REVISION_REQUIRED: 'Cần chỉnh sửa',
  ARCHIVED: 'Đã lưu trữ',
};
export const ASSET_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

/** Fonts are a technical allow-list (they must exist where previews are rendered), not business data. */
export const DESIGN_FONTS = [
  {
    id: 'bubble',
    label: 'Kẹo bong bóng',
    family: "'Fredoka One', 'Arial Rounded MT Bold', Arial, sans-serif",
  },
  { id: 'serif', label: 'Có chân', family: "Georgia, 'Times New Roman', serif" },
  { id: 'sans', label: 'Không chân', family: 'Arial, Helvetica, sans-serif' },
  { id: 'script', label: 'Viết tay', family: "'Brush Script MT', 'Segoe Script', cursive" },
] as const;
const fontIds = DESIGN_FONTS.map((f) => f.id) as [string, ...string[]];

const money = z.number().int().min(0).max(100_000_000);
const optionId = z.string().regex(/^[a-z0-9_-]{1,30}$/, 'Mã gồm chữ thường, số, - hoặc _');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Màu dạng #RRGGBB');
/** Path data only: commands, numbers and separators. Nothing that could break out of an attribute. */
const pathData = z
  .string()
  .max(800)
  .regex(/^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]+$/, 'Đường vẽ không hợp lệ');

/** Object-store key of a processed charm picture; only keys produced by our own upload are accepted. */
export const motifImageKey = z
  .string()
  .regex(/^custom\/motifs\/[0-9a-f-]{36}\.webp$/, 'Ảnh biểu tượng không hợp lệ');

/** Stickers and letters come in these pastel colours until the shop edits them: blue, pink, purple, yellow, green. */
export const DEFAULT_STICKER_COLORS = [
  { id: 'blue', name: 'Xanh dương', hex: '#aec9ea' },
  { id: 'pink', name: 'Hồng', hex: '#ebb5c8' },
  { id: 'purple', name: 'Tím', hex: '#c5a3e3' },
  { id: 'yellow', name: 'Vàng', hex: '#f5ec9b' },
  { id: 'green', name: 'Xanh lá', hex: '#b6d8b5' },
] as const;

/** A word is placed letter by letter: this splits it into user-perceived characters (NFC, so "ằ" stays one). */
export function splitLetters(text: string): string[] {
  const s = text.normalize('NFC');
  const Seg = (Intl as { Segmenter?: new (l?: string, o?: object) => { segment: (t: string) => Iterable<{ segment: string }> } }).Segmenter;
  const parts = Seg
    ? Array.from(new Seg('vi', { granularity: 'grapheme' }).segment(s), (x) => x.segment)
    : Array.from(s);
  return parts.filter((c) => c.trim() !== '');
}

/** Admin-managed catalogue of what customers may choose, and what each choice adds to the price. */
export const customOptionsBaseSchema = z.object({
  enabled: z.boolean(),
  /** If true a design must be APPROVED by staff before it can be ordered. */
  requireApproval: z.boolean(),
  maxLayers: z.number().int().min(1).max(12),
  /** Whether customers may add their own text / upload their own picture besides the shop's charms. */
  allowText: z.boolean().default(true),
  allowImage: z.boolean().default(true),
  /** Most letters a customer may type in one go; each letter becomes its own layer. */
  maxTextLength: z.number().int().min(1).max(60),
  /** Real height (cm) of one letter on the product, like a charm's size: with the product's width it fixes the letter's proportion. */
  letterHeightCm: z.number().min(0.5).max(30).default(4),
  /** The colours a sticker or letter can take (pastel palette, edited by the shop). */
  stickerColors: z
    .array(z.object({ id: optionId, name: z.string().trim().min(1).max(30), hex }))
    .min(1)
    .max(10)
    .default(DEFAULT_STICKER_COLORS.map((c) => ({ ...c }))),
  /** Shown to customers in the "Lưu ý" box under the designer (empty = a default note). */
  note: z.string().trim().max(500).default(''),
  /** Real width (cm) of a customer-uploaded picture on the hat. */
  imageSizeCm: z.number().min(1).max(60).default(10),
  textPriceVnd: money,
  imagePriceVnd: money,
  motifs: z
    .array(
      z
        .object({
          id: optionId,
          name: z.string().trim().min(1).max(40),
          /** Vector shape (SVG path data) the customer can recolour. */
          path: pathData.nullable().default(null),
          /** Or an uploaded picture (processed by the API into a small transparent WebP). */
          imageKey: motifImageKey.nullable().default(null),
          /** Real width of the charm in centimetres: with the hat's width it fixes the charm's proportion. */
          sizeCm: z.number().min(1).max(60).default(10),
          /** Real height of the charm in cm; null = same as the width (a square charm). */
          heightCm: z.number().min(1).max(60).nullable().default(null),
          priceVnd: money,
          /**
           * How the palette colours the sticker: 'flat' = a one-colour silhouette (icons, vector shapes);
           * 'shaded' = a photo-like picture keeps its light and shadow and takes the colour (stones, pearls, shells);
           * 'none' = the picture keeps its own colours.
           */
          tint: z.enum(['flat', 'shaded', 'none']).default('flat'),
        })
        .refine(
          (m) => m.path !== null || m.imageKey !== null,
          'Cần có đường vẽ hoặc ảnh biểu tượng',
        ),
    )
    .max(30),
});
export const customOptionsSchema = customOptionsBaseSchema.strict().superRefine((o, ctx) => {
  const ids = o.motifs.map((x) => x.id);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', path: ['motifs'], message: 'Mã bị trùng' });
});
export type CustomOptions = z.infer<typeof customOptionsSchema>;

const position = {
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  scale: z.number().min(0.2).max(3),
  rotation: z.number().min(-180).max(180),
};
/** Charms (motifs) and uploaded images have a fixed physical size set by the hat's proportions, never by the customer. */
const fixed = (v: number) =>
  z
    .number()
    .optional()
    .transform(() => v);
/** Charms can be dragged and rotated, but never resized. */
const charmPosition = {
  x: position.x,
  y: position.y,
  rotation: position.rotation,
  scale: fixed(1),
};
/** One letter per layer (letters are dragged around one by one), at the real size the shop configured. */
const letter = z
  .string()
  .min(1)
  .max(12)
  .transform((v) => v.normalize('NFC'))
  .refine((v) => splitLetters(v).length === 1, 'Mỗi lớp chữ chỉ chứa một chữ cái');
export const layerInputSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('TEXT'),
    text: letter,
    fontId: z.enum(fontIds),
    /** A colour of `options.stickerColors`; absent = the first one. */
    colorId: optionId.optional(),
    ...charmPosition,
  }),
  z.object({
    kind: z.literal('MOTIF'),
    motifId: optionId,
    colorId: optionId.optional(),
    ...charmPosition,
  }),
  z.object({ kind: z.literal('IMAGE'), assetId: z.string().uuid(), ...charmPosition }),
]);
export type LayerInput = z.infer<typeof layerInputSchema>;

export const designContentSchema = z.object({
  title: z.string().trim().min(1).max(80).default('Nón thiết kế riêng'),
  /** The hat the customer designs on: its variant (colour) picture is the canvas. */
  variantId: z.string().uuid(),
  layers: z.array(layerInputSchema).max(12),
});
export type DesignContent = z.infer<typeof designContentSchema>;

export const createDesignSchema = designContentSchema.extend({
  contactEmail: z.string().trim().toLowerCase().email().max(254).optional(),
});
export const updateDesignSchema = designContentSchema
  .partial()
  .extend({ contactEmail: z.string().trim().toLowerCase().email().max(254).nullable().optional() });
export const submitDesignSchema = z
  .object({ contactEmail: z.string().trim().toLowerCase().email().max(254).optional() })
  .default({});

export const reviewDesignSchema = z.object({
  decision: z.enum(['APPROVE', 'REQUEST_REVISION']),
  note: z.string().trim().max(500).optional(),
  /** Uploaded images the reviewer rejects (they must be replaced). */
  rejectAssetIds: z.array(z.string().uuid()).max(12).default([]),
});

/** Problems that stop a design from being saved as submittable. Pure; same rules on client and server. */
export function validateDesign(
  content: DesignContent,
  options: CustomOptions,
  assetStatus?: (assetId: string) => AssetStatus | null,
): string[] {
  const issues: string[] = [];
  if (content.layers.length > options.maxLayers)
    issues.push(`Tối đa ${options.maxLayers} lớp thiết kế`);
  content.layers.forEach((l, i) => {
    const n = i + 1;
    if (l.kind === 'TEXT') {
      if (!options.allowText) issues.push(`Lớp ${n}: dịch vụ không cho thêm chữ`);
      if (l.colorId && !options.stickerColors.some((c) => c.id === l.colorId))
        issues.push(`Lớp ${n}: màu chữ không hợp lệ`);
    } else if (l.kind === 'MOTIF') {
      const m = options.motifs.find((x) => x.id === l.motifId);
      if (!m) issues.push(`Lớp ${n}: họa tiết không hợp lệ`);
      else if (l.colorId && !options.stickerColors.some((c) => c.id === l.colorId))
        issues.push(`Lớp ${n}: màu họa tiết không hợp lệ`);
    } else if (!options.allowImage) {
      issues.push(`Lớp ${n}: dịch vụ không cho tải ảnh riêng`);
    } else if (assetStatus) {
      const s = assetStatus(l.assetId);
      if (s === null) issues.push(`Lớp ${n}: không tìm thấy ảnh đã tải lên`);
      else if (s === 'REJECTED') issues.push(`Lớp ${n}: ảnh đã bị từ chối, hãy thay ảnh khác`);
    }
  });
  return issues;
}

export interface PriceLine {
  label: string;
  amountVnd: number;
}
/** What the customisation adds on top of the base variant price. Integer VND, from admin-managed prices. */
export function priceDesign(
  content: Pick<DesignContent, 'layers'>,
  options: CustomOptions,
): { totalVnd: number; lines: PriceLine[] } {
  const lines: PriceLine[] = [];
  for (const l of content.layers) {
    if (l.kind === 'TEXT' && options.textPriceVnd > 0)
      lines.push({ label: `Chữ “${l.text}”`, amountVnd: options.textPriceVnd });
    else if (l.kind === 'IMAGE' && options.imagePriceVnd > 0)
      lines.push({ label: 'Ảnh riêng', amountVnd: options.imagePriceVnd });
    else if (l.kind === 'MOTIF') {
      const m = options.motifs.find((x) => x.id === l.motifId);
      if (m && m.priceVnd > 0) lines.push({ label: `Họa tiết: ${m.name}`, amountVnd: m.priceVnd });
    }
  }
  return { totalVnd: lines.reduce((s, l) => s + l.amountVnd, 0), lines };
}

const esc = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const n2 = (v: number) => (Number.isFinite(v) ? v.toFixed(2) : '0');
/** Image sources the renderer will accept: inline data, same-site paths or https. Anything else is skipped. */
const SAFE_HREF =
  /^(data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/=]+|\/[A-Za-z0-9/_\-.?=&%]*|https:\/\/[^\s"'<>]+)$/;

/**
 * A charm covers a fixed share of the hat so every design scales the same way: on a 40 x 30 cm hat a
 * charm is about 10 x 10 cm, i.e. a quarter of the hat's width (8 units per cm in this geometry).
 */
export const CHARM_SIZE = 80;
/** Width (cm) assumed for a hat whose width the shop has not entered (and for the drawn generic hat). */
export const DEFAULT_HAT_CM = 40;
/** On-canvas width and height of a charm from its real width/height (cm). */
export function charmBox(
  m: { sizeCm: number; heightCm?: number | null },
  hatWidthCm: number | null | undefined,
  area: { width: number; height?: number },
  hatHeightCm?: number | null,
): { w: number; h: number } {
  const w = charmUnits(m.sizeCm, hatWidthCm, area, hatHeightCm);
  const h = m.heightCm ? charmUnits(m.heightCm, hatWidthCm, area, hatHeightCm) : w;
  return { w, h };
}
/**
 * On-canvas side (viewBox units) of a charm/picture that is `sizeCm` wide on a hat `hatWidthCm` wide:
 * the same share of the hat's width as in real life, within sensible bounds.
 */
export function charmUnits(
  sizeCm: number,
  hatWidthCm: number | null | undefined,
  area: { width: number; height?: number },
  hatHeightCm?: number | null,
): number {
  // width wins; with only a height the picture's height is the yardstick; with neither, 40 cm wide
  const unitsPerCm =
    hatWidthCm && hatWidthCm > 0
      ? area.width / hatWidthCm
      : hatHeightCm && hatHeightCm > 0 && area.height
        ? area.height / hatHeightCm
        : area.width / DEFAULT_HAT_CM;
  return Math.max(14, Math.min(area.width * 0.9, sizeCm * unitsPerCm));
}
/** Hat geometry shared with the editor's drag handles (viewBox units). */
export const HAT_BOX = {
  left: 40,
  top: 150,
  width: 320,
  height: 208,
  viewW: 400,
  viewH: 500,
} as const;
/** Where a newly added charm first lands (x, y as a share of the hat box); the customer drags it from there. */
export const CHARM_SLOTS = [
  { x: 0.5, y: 0.78 },
  { x: 0.28, y: 0.78 },
  { x: 0.72, y: 0.78 },
  { x: 0.4, y: 0.52 },
  { x: 0.6, y: 0.52 },
  { x: 0.5, y: 0.3 },
] as const;

export interface DesignArea {
  left: number;
  top: number;
  width: number;
  height: number;
  viewW: number;
  viewH: number;
}
/** A hat picture supplied by the shop (already trimmed to the hat, transparent background). */
export interface HatImage {
  href: string;
  width: number;
  height: number;
}
/**
 * The rectangle that layer coordinates (0..1) refer to. With a hat picture the canvas IS the picture
 * (400 units wide, as tall as its proportions need), so the designer shows the picture exactly as the shop
 * does, with no margins around it. Without one it is the drawn hat's box on a 400 x 500 canvas.
 */
export const CANVAS_PAD = { side: 28, top: 28, bottom: 64 } as const;
export function designArea(hat?: { width: number; height: number } | null): DesignArea {
  if (!hat || hat.width <= 0 || hat.height <= 0) return { ...HAT_BOX };
  const height = Math.round((400 * hat.height) / hat.width);
  // breathing room around the picture, most of it underneath so the rim never touches the frame
  return {
    left: CANVAS_PAD.side,
    top: CANVAS_PAD.top,
    width: 400,
    height,
    viewW: 400 + 2 * CANVAS_PAD.side,
    viewH: height + CANVAS_PAD.top + CANVAS_PAD.bottom,
  };
}

/** Charm/text colour is fixed (dark with a light outline so it reads on any hat); customers only pick shapes. */
const TEXT_FILL = '#242a27';
const TEXT_STROKE = '#fffaf0';

/** Darkens a #rrggbb colour (for the thin edge that keeps a pastel sticker readable on the straw). */
const shade = (hexColor: string, by = 0.38) => {
  const n = parseInt(hexColor.slice(1), 16);
  const c = (shift: number) => Math.round(((n >> shift) & 255) * (1 - by));
  return `#${[16, 8, 0].map((s) => c(s).toString(16).padStart(2, '0')).join('')}`;
};
/** The palette colour for a layer (absent or unknown = the first one), with its edge colour. */
const colorOf = (options: Pick<CustomOptions, 'stickerColors'>, id?: string) => {
  const c = options.stickerColors.find((x) => x.id === id) ?? options.stickerColors[0];
  const hexValue = c?.hex ?? TEXT_FILL;
  return { id: c?.id ?? 'ink', hex: hexValue, edge: c ? shade(hexValue) : TEXT_STROKE };
};

export interface RenderExtras {
  /** Resolves a processed charm picture key to a loadable URL (or inline data). */
  motifHref?: (imageKey: string) => string | null;
  hat?: HatImage | null;
  /** Real width of the hat in cm (see `charmUnits`). */
  hatWidthCm?: number | null;
  hatHeightCm?: number | null;
  /** Leave the backdrop out (the page already provides one): the live editor sets this, stored previews do not. */
  transparentBackground?: boolean;
}

/**
 * Deterministic SVG of the customised hat. Every dynamic value is escaped or validated (ids resolved
 * through the admin catalogue, numbers formatted, fonts from an allow-list, hrefs pattern-checked), so
 * the markup is safe to inject into a page.
 */
export function renderHatSvg(
  design: Pick<DesignContent, 'layers'>,
  options: CustomOptions,
  assetHref: (assetId: string) => string | null = () => null,
  uid = 'h',
  extras: RenderExtras = {},
): string {
  const hat = extras.hat && SAFE_HREF.test(extras.hat.href) ? extras.hat : null;
  const area = designArea(hat);
  const backdrop = extras.transparentBackground
    ? ''
    : `<rect width="${area.viewW}" height="${area.viewH}" fill="#f5f0e5"/>`;
  const body: string[] = [];
  const defs: string[] = [];
  const tints = new Set<string>();
  for (const l of design.layers) {
    const px = area.left + l.x * area.width;
    const py = area.top + l.y * area.height;
    const t = `translate(${n2(px)} ${n2(py)}) rotate(${n2(l.rotation)}) scale(${n2(l.scale)})`;
    if (l.kind === 'TEXT') {
      const font = DESIGN_FONTS.find((f) => f.id === l.fontId)?.family ?? DESIGN_FONTS[0].family;
      // the letter's cap height is the configured real height (cm) in proportion to the product's width
      const size = n2(
        charmUnits(options.letterHeightCm, extras.hatWidthCm, area, extras.hatHeightCm) / 0.72,
      );
      const color = colorOf(options, l.colorId);
      const glyph = l.fontId === 'bubble' ? bubbleGlyph(l.text) : null;
      if (glyph) {
        // Candy letter like the shop's sticker sheet: a puffy body (the glyph fattened by its own stroke), a darker rim,
        // a light highlight on the top-left edge, a soft shade on the bottom-right and a glossy blob.
        const s = (Number(size) * 0.72) / 100;
        const hl = `${uid}-bh-${color.id}`;
        if (!tints.has(hl)) {
          tints.add(hl);
          defs.push(
            `<linearGradient id="${hl}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`,
            `<linearGradient id="${uid}-bd-${color.id}" x1="0" y1="0" x2="1" y2="1"><stop offset=".45" stop-color="${shade(color.hex, 0.45)}" stop-opacity="0"/><stop offset="1" stop-color="${shade(color.hex, 0.45)}" stop-opacity=".55"/></linearGradient>`,
          );
        }
        const d = glyph.d;
        body.push(
          `<g transform="${t}"><g transform="scale(${n2(s)}) translate(${n2(-glyph.w / 2)} -50)" stroke-linejoin="round" stroke-linecap="round">` +
            `<path d="${d}" transform="translate(1.4 2)" fill="#3b1f2a" fill-opacity=".14" stroke="#3b1f2a" stroke-opacity=".14" stroke-width="5.4"/>` +
            `<path d="${d}" fill="${color.edge}" stroke="${color.edge}" stroke-width="5.4"/>` +
            `<path d="${d}" fill="${color.hex}" stroke="${color.hex}" stroke-width="3.6"/>` +
            `<path d="${d}" transform="translate(-.6 -.8)" fill="none" stroke="url(#${hl})" stroke-width="1.9"/>` +
            `<path d="${d}" transform="translate(.8 1)" fill="none" stroke="url(#${uid}-bd-${color.id})" stroke-width="1.9"/>` +
            `<ellipse cx="${n2(glyph.w * 0.3)}" cy="14" rx="${n2(Math.max(3.5, glyph.w * 0.1))}" ry="3.2" transform="rotate(-25 ${n2(glyph.w * 0.3)} 14)" fill="#fff" fill-opacity=".7"/>` +
            `</g></g>`,
        );
        continue;
      }
      body.push(
        `<text transform="${t}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="700" font-family="${esc(font)}" fill="${color.hex}" stroke="${color.edge}" stroke-width="1.6" stroke-linejoin="round" paint-order="stroke">${esc(l.text)}</text>`,
      );
    } else if (l.kind === 'MOTIF') {
      const m = options.motifs.find((x) => x.id === l.motifId);
      const box = charmBox(m ?? { sizeCm: 10 }, extras.hatWidthCm, area, extras.hatHeightCm);
      const bw = n2(box.w);
      const bh = n2(box.h);
      const color = !m || m.tint === 'none' ? null : colorOf(options, l.colorId);
      if (m?.imageKey) {
        const href = extras.motifHref?.(m.imageKey);
        if (href && SAFE_HREF.test(href)) {
          // a recolourable picture is a flat silhouette filled with the chosen colour (its alpha is the shape)
          let filter = '';
          if (color) {
            const shaded = m.tint === 'shaded';
            const fid = `${uid}-${shaded ? 'shade' : 'tint'}-${color.id}`;
            if (!tints.has(fid)) {
              tints.add(fid);
              // flat: fill the silhouette; shaded: multiply the colour into the picture so its light and shadow stay
              defs.push(
                shaded
                  ? `<filter id="${fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood flood-color="${color.hex}" result="c"/><feBlend in="SourceGraphic" in2="c" mode="multiply" result="m"/><feComposite in="m" in2="SourceAlpha" operator="in"/></filter>`
                  : `<filter id="${fid}" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB"><feFlood flood-color="${color.hex}"/><feComposite in2="SourceAlpha" operator="in"/></filter>`,
              );
            }
            filter = ` filter="url(#${fid})"`;
          }
          body.push(
            `<image href="${esc(href)}" x="${-Number(bw) / 2}" y="${-Number(bh) / 2}" width="${bw}" height="${bh}" preserveAspectRatio="xMidYMid meet" transform="${t}"${filter}/>`,
          );
        }
      } else if (m?.path)
        body.push(
          `<path d="${m.path}" fill="${color?.hex ?? TEXT_FILL}" stroke="${color?.edge ?? TEXT_STROKE}" stroke-width="${color ? 2.4 : 3}" stroke-linejoin="round" paint-order="stroke" transform="${t} scale(${Number(bw) / 100} ${Number(bh) / 100}) translate(-50 -50)"/>`,
        );
    } else {
      const href = assetHref(l.assetId);
      const size = n2(charmUnits(options.imageSizeCm, extras.hatWidthCm, area, extras.hatHeightCm));
      if (href && SAFE_HREF.test(href))
        body.push(
          `<image href="${esc(href)}" x="${-Number(size) / 2}" y="${-Number(size) / 2}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice" transform="${t}"/>`,
        );
    }
  }
  if (hat) {
    const img = `<image href="${esc(hat.href)}" x="${n2(area.left)}" y="${n2(area.top)}" width="${n2(area.width)}" height="${n2(area.height)}" preserveAspectRatio="none"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${area.viewW} ${area.viewH}" role="img">
<defs>
${defs.join('')}
<mask id="${uid}-hm" maskUnits="userSpaceOnUse" x="${n2(area.left)}" y="${n2(area.top)}" width="${n2(area.width)}" height="${n2(area.height)}" style="mask-type:alpha">${img}</mask>
</defs>
${backdrop}
${img}
<g mask="url(#${uid}-hm)">${body.join('')}</g>
</svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" role="img">
${backdrop}
<ellipse cx="200" cy="346" rx="156" ry="26" fill="#22271f" opacity=".13"/>
${hatMarkup(uid)}
<defs>${defs.join('')}</defs>
<g clip-path="url(#${uid}-shape)">${body.join('')}</g>
</svg>`;
}

// ---- DTOs --------------------------------------------------------------------------------------

export const designLayerSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  kind: z.enum(['TEXT', 'MOTIF', 'IMAGE']),
  text: z.string().nullable(),
  fontId: z.string().nullable(),
  motifId: z.string().nullable(),
  colorId: z.string().nullable().default(null),
  assetId: z.string().nullable(),
  x: z.number(),
  y: z.number(),
  scale: z.number(),
  rotation: z.number(),
});
export const designVersionSchema = z.object({
  id: z.string(),
  versionNo: z.number().int(),
  status: z.enum(DESIGN_STATUSES),
  variantId: z.string(),
  layers: z.array(designLayerSchema),
  /** Frozen at submission; null while still a draft (use priceDesign for the live estimate). */
  priceAdditionVnd: z.number().int().nullable(),
  hasPreview: z.boolean(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type DesignVersionDto = z.infer<typeof designVersionSchema>;

export const designAssetSchema = z.object({
  id: z.string(),
  status: z.enum(ASSET_STATUSES),
  width: z.number().int(),
  height: z.number().int(),
  reviewNote: z.string().nullable(),
  createdAt: z.string(),
});
export type DesignAssetDto = z.infer<typeof designAssetSchema>;

export const designSchema = z.object({
  id: z.string(),
  title: z.string(),
  contactEmail: z.string().nullable(),
  updatedAt: z.string(),
  product: z.object({
    slug: z.string(),
    name: z.string(),
    variantName: z.string(),
    basePriceVnd: z.number().int(),
    imageUrl: z.string().nullable(),
  }),
  latest: designVersionSchema,
  versions: z.array(
    z.object({
      id: z.string(),
      versionNo: z.number().int(),
      status: z.enum(DESIGN_STATUSES),
      createdAt: z.string(),
    }),
  ),
  assets: z.array(designAssetSchema),
});
export type DesignDto = z.infer<typeof designSchema>;

export const designListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(DESIGN_STATUSES),
      versionId: z.string(),
      versionNo: z.number().int(),
      hasPreview: z.boolean(),
      productName: z.string(),
      updatedAt: z.string(),
      canOrder: z.boolean(),
    }),
  ),
});

export const customCatalogSchema = z.object({
  options: customOptionsSchema,
  /** Base URL of the public media store; charm pictures are `${mediaBase}/${imageKey}`. */
  mediaBase: z.string(),
  products: z.array(
    z.object({
      slug: z.string(),
      name: z.string(),
      /** The product type it belongs to (Nón lá, Móc khóa, Kẹp tóc…): the designer's "Chọn sản phẩm" list. */
      type: z.object({ slug: z.string(), name: z.string() }).nullable().default(null),
      imageUrl: z.string().nullable(),
      /** Real width of the hat in cm (null = not entered: a default is assumed). */
      hatWidthCm: z.number().nullable().default(null),
      hatHeightCm: z.number().nullable().default(null),
      variants: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          priceVnd: z.number().int(),
          availability: z.enum(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']),
          /** The picture of this hat (its colour): customers design right on it. null = generic drawn hat. */
          image: z
            .object({ url: z.string(), width: z.number().int(), height: z.number().int() })
            .nullable(),
        }),
      ),
    }),
  ),
});
export type CustomCatalog = z.infer<typeof customCatalogSchema>;

export const adminDesignListQuerySchema = z.object({
  status: z.enum(DESIGN_STATUSES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const adminDesignListSchema = z.object({
  items: z.array(
    z.object({
      designId: z.string(),
      versionId: z.string(),
      versionNo: z.number().int(),
      title: z.string(),
      status: z.enum(DESIGN_STATUSES),
      owner: z.string(),
      productName: z.string(),
      submittedAt: z.string().nullable(),
      hasPreview: z.boolean(),
    }),
  ),
  meta: z.object({ page: z.number().int(), pageSize: z.number().int(), total: z.number().int() }),
});
export const adminDesignDetailSchema = designSchema.extend({
  owner: z.string(),
  ownerKind: z.enum(['ACCOUNT', 'GUEST']),
  priceLines: z.array(z.object({ label: z.string(), amountVnd: z.number().int() })),
});
export type AdminDesignDetail = z.infer<typeof adminDesignDetailSchema>;

/** Snapshot copied onto an order item: readable forever, independent of later catalogue edits. */
export const orderCustomizationSchema = z.object({
  designId: z.string(),
  versionId: z.string(),
  versionNo: z.number().int(),
  title: z.string(),
  /** The hat variant (colour) the design was made on, e.g. "Đỏ". Older orders also carry `hatColor`. */
  variantName: z.string().nullable().default(null),
  hatColor: z
    .object({ id: z.string(), name: z.string(), hex: z.string() })
    .nullable()
    .default(null),
  layers: z.array(
    z.object({
      kind: z.enum(['TEXT', 'MOTIF', 'IMAGE']),
      summary: z.string(),
      /** For a charm: its code and name as they were when the order was placed (so staff never mix them up). */
      charmCode: z.string().nullable().default(null),
      charmName: z.string().nullable().default(null),
      /** Colour name of a sticker or letter as it was when the order was placed (e.g. "Hồng"). */
      colorName: z.string().nullable().default(null),
    }),
  ),
  priceAdditionVnd: z.number().int(),
  priceLines: z.array(z.object({ label: z.string(), amountVnd: z.number().int() })),
  approvedAt: z.string().nullable(),
});
export type OrderCustomization = z.infer<typeof orderCustomizationSchema>;
