import { describe, expect, it } from 'vitest';
import {
  CHARM_SIZE,
  charmBox,
  charmUnits,
  designArea,
  customOptionsSchema,
  layerInputSchema,
  priceDesign,
  renderHatSvg,
  validateDesign,
  type CustomOptions,
  type DesignContent,
} from './design';

const options: CustomOptions = customOptionsSchema.parse({
  enabled: true,
  requireApproval: true,
  maxLayers: 3,
  maxTextLength: 10,
  textPriceVnd: 30_000,
  imagePriceVnd: 60_000,
  motifs: [
    { id: 'star', name: 'Sao', path: 'M50 8 L61 38 Z', priceVnd: 20_000 },
    { id: 'free', name: 'Miễn phí', path: 'M0 0 L10 10 Z', priceVnd: 0 },
  ],
});
const pos = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };
const design = (layers: DesignContent['layers']): DesignContent => ({
  title: 'Nón của tôi',
  variantId: '00000000-0000-4000-8000-000000000001',
  layers,
});
const IMG = '11111111-1111-4111-8111-111111111111';

describe('priceDesign', () => {
  it('adds admin-configured prices per text, motif and image (integer VND)', () => {
    const p = priceDesign(
      design([
        { kind: 'TEXT', text: 'Lan', fontId: 'serif', ...pos },
        { kind: 'MOTIF', motifId: 'star', ...pos },
        { kind: 'IMAGE', assetId: IMG, ...pos },
      ]),
      options,
    );
    expect(p.totalVnd).toBe(30_000 + 20_000 + 60_000);
    expect(p.lines.map((l) => l.amountVnd)).toEqual([30_000, 20_000, 60_000]);
    expect(Number.isInteger(p.totalVnd)).toBe(true);
  });
  it('charges nothing for free options and an empty design', () => {
    expect(priceDesign(design([]), options)).toEqual({ totalVnd: 0, lines: [] });
    expect(
      priceDesign(design([{ kind: 'MOTIF', motifId: 'free', ...pos }]), options).totalVnd,
    ).toBe(0);
  });
  it('follows the options it is given (prices are data, not constants)', () => {
    const pricier = { ...options, textPriceVnd: 99_000 };
    expect(
      priceDesign(design([{ kind: 'TEXT', text: 'A', fontId: 'sans', ...pos }]), pricier).totalVnd,
    ).toBe(99_000);
  });
});

describe('validateDesign', () => {
  const ok = design([{ kind: 'TEXT', text: 'Lan', fontId: 'serif', ...pos }]);
  it('accepts a valid design', () => expect(validateDesign(ok, options)).toEqual([]));
  it('rejects unknown motifs, too many layers and too long text', () => {
    expect(
      validateDesign(design([{ kind: 'MOTIF', motifId: 'nope', ...pos }]), options).join(),
    ).toMatch(/họa tiết không hợp lệ/);
    expect(
      validateDesign(
        design(
          Array.from({ length: 4 }, () => ({
            kind: 'MOTIF' as const,
            motifId: 'star',
            ...pos,
          })),
        ),
        options,
      ).join(),
    ).toMatch(/Tối đa 3/);
    expect(
      validateDesign(
        design([{ kind: 'TEXT', text: 'x'.repeat(11), fontId: 'serif', ...pos }]),
        options,
      ).join(),
    ).toMatch(/tối đa 10/);
  });
  it('refuses text and pictures when the shop turns them off, but keeps charms', () => {
    const off = { ...options, allowText: false, allowImage: false };
    expect(validateDesign(ok, off).join()).toMatch(/không cho thêm chữ/);
    expect(
      validateDesign(
        design([{ kind: 'IMAGE', assetId: IMG, ...pos }]),
        off,
        () => 'APPROVED',
      ).join(),
    ).toMatch(/không cho tải ảnh/);
    expect(validateDesign(design([{ kind: 'MOTIF', motifId: 'star', ...pos }]), off)).toEqual([]);
  });
  it('checks uploaded images against their moderation status', () => {
    const withImage = design([{ kind: 'IMAGE', assetId: IMG, ...pos }]);
    expect(validateDesign(withImage, options, () => 'APPROVED')).toEqual([]);
    expect(validateDesign(withImage, options, () => 'PENDING')).toEqual([]); // pending is allowed to be submitted for review
    expect(validateDesign(withImage, options, () => 'REJECTED').join()).toMatch(/từ chối/);
    expect(validateDesign(withImage, options, () => null).join()).toMatch(/không tìm thấy ảnh/);
  });
});

describe('options schema', () => {
  it('refuses duplicate ids and path data that could break out of markup', () => {
    const base = { ...options };
    expect(
      customOptionsSchema.safeParse({
        ...base,
        motifs: [{ id: 'x', name: 'X', path: 'M0 0" onload="alert(1)', priceVnd: 0 }],
      }).success,
    ).toBe(false);
    expect(
      customOptionsSchema.safeParse({
        ...base,
        motifs: [{ id: 'x', name: 'X', path: '<script>', priceVnd: 0 }],
      }).success,
    ).toBe(false);
    expect(customOptionsSchema.safeParse({ ...base, textPriceVnd: 10.5 }).success).toBe(false);
  });
});

describe('renderHatSvg', () => {
  it('draws every layer kind on the generic hat', () => {
    const svg = renderHatSvg(
      design([
        { kind: 'TEXT', text: 'Lan', fontId: 'serif', ...pos },
        { kind: 'MOTIF', motifId: 'star', ...pos },
        { kind: 'IMAGE', assetId: IMG, ...pos },
      ]),
      options,
      () => 'data:image/webp;base64,AAAA',
    );
    expect(svg).toContain('>Lan</text>');
    expect(svg).toContain('M50 8 L61 38 Z');
    expect(svg).toContain('data:image/webp;base64,AAAA');
  });
  it('is deterministic', () => {
    const d = design([{ kind: 'TEXT', text: 'Lan', fontId: 'serif', ...pos }]);
    expect(renderHatSvg(d, options)).toBe(renderHatSvg(d, options));
  });
  it('escapes text so customer input can never inject markup', () => {
    const evil = '<script>alert(1)</script>&"\'';
    const svg = renderHatSvg(
      design([{ kind: 'TEXT', text: evil, fontId: 'serif', ...pos }]),
      options,
    );
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;&#39;');
  });
  it('only accepts safe image sources', () => {
    const d = design([{ kind: 'IMAGE', assetId: IMG, ...pos }]);
    for (const bad of [
      'javascript:alert(1)',
      'data:text/html;base64,AAAA',
      'http://evil.example/x.png',
      '"><script>',
      'file:///etc/passwd',
    ]) {
      expect(
        renderHatSvg(d, options, () => bad),
        bad,
      ).not.toContain('<image');
    }
    expect(renderHatSvg(d, options, () => '/api/custom-designs/assets/abc/content')).toContain(
      '<image',
    );
    expect(renderHatSvg(d, options, () => 'https://cdn.example/x.webp')).toContain('<image');
  });
  it('skips layers that reference options that no longer exist instead of failing', () => {
    expect(() =>
      renderHatSvg(design([{ kind: 'MOTIF', motifId: 'deleted', ...pos }]), options),
    ).not.toThrow();
  });
});

describe('real sizes', () => {
  it('sizes a charm by its real width against the hat width', () => {
    const area = { width: 320 };
    expect(charmUnits(10, 40, area)).toBe(80); // 10 cm on a 40 cm hat = a quarter of it
    expect(charmUnits(10, 20, area)).toBe(160); // the same charm on a smaller hat is relatively bigger
    expect(charmUnits(10, null, area)).toBe(80); // unknown hat width: 40 cm assumed
    expect(charmUnits(10, null, { width: 320, height: 208 }, 20)).toBeCloseTo(104); // height only
    expect(charmUnits(200, 10, area)).toBeLessThanOrEqual(288); // never larger than the hat
  });
  it('draws bigger charms bigger and the same charm bigger on a narrower hat', () => {
    const big = { ...options, motifs: options.motifs.map((m) => ({ ...m, sizeCm: 20 })) };
    const d = design([{ kind: 'MOTIF', motifId: 'star', ...pos }]);
    expect(renderHatSvg(d, big)).toContain(`scale(${160 / 100} ${160 / 100})`);
    expect(renderHatSvg(d, options, () => null, 'h', { hatWidthCm: 20 })).toContain(
      `scale(${160 / 100} ${160 / 100})`,
    );
  });
});

describe('charm width and height', () => {
  const area = { width: 320, height: 240 };
  it('uses the real width and height; a missing height means square', () => {
    expect(charmBox({ sizeCm: 10, heightCm: 5 }, 40, area)).toEqual({ w: 80, h: 40 });
    expect(charmBox({ sizeCm: 10 }, 40, area)).toEqual({ w: 80, h: 80 });
  });
  it('draws a non-square charm into a rectangle', () => {
    const wide = {
      ...options,
      motifs: options.motifs.map((m) => ({ ...m, sizeCm: 20, heightCm: 10 })),
    };
    const svg = renderHatSvg(design([{ kind: 'MOTIF', motifId: 'star', ...pos }]), wide);
    expect(svg).toContain(`scale(${160 / 100} ${80 / 100})`);
  });
});

describe('charm size', () => {
  it('is a fixed share of the hat: client scale is discarded for motifs and images, kept for text', () => {
    expect(
      layerInputSchema.parse({
        kind: 'MOTIF',
        motifId: 'star',
        x: 0.5,
        y: 0.5,
        rotation: 0,
        scale: 3,
      }),
    ).toMatchObject({ scale: 1 });
    expect(
      layerInputSchema.parse({ kind: 'IMAGE', assetId: IMG, x: 0.5, y: 0.5, rotation: 0 }),
    ).toMatchObject({ scale: 1 });
    expect(
      layerInputSchema.parse({
        kind: 'TEXT',
        text: 'a',
        fontId: 'serif',
        x: 0.5,
        y: 0.5,
        rotation: 0,
        scale: 2,
      }),
    ).toMatchObject({ scale: 2 });
  });
  it('renders every charm at the same size regardless of the stored scale', () => {
    const a = renderHatSvg(design([{ kind: 'MOTIF', motifId: 'star', ...pos }]), options);
    const b = renderHatSvg(design([{ kind: 'MOTIF', motifId: 'star', ...pos, scale: 1 }]), options);
    expect(a).toBe(b);
    expect(a).toContain(`scale(${CHARM_SIZE / 100} ${CHARM_SIZE / 100})`);
  });
});

describe('charm placement', () => {
  it('keeps the dragged position and rotation but discards size', () => {
    expect(
      layerInputSchema.parse({
        kind: 'MOTIF',
        motifId: 'star',
        x: 0.1,
        y: 0.9,
        rotation: 90,
        scale: 3,
      }),
    ).toMatchObject({ x: 0.1, y: 0.9, rotation: 90, scale: 1 });
    expect(
      layerInputSchema.safeParse({
        kind: 'MOTIF',
        motifId: 'star',
        x: 0.5,
        y: 0.5,
        rotation: 400,
      }).success,
    ).toBe(false);
    expect(
      layerInputSchema.safeParse({ kind: 'MOTIF', motifId: 'star', x: 1.5, y: 0.5 }).success,
    ).toBe(false);
  });
  it('renders a charm where it was placed', () => {
    const svg = renderHatSvg(
      design([{ kind: 'MOTIF', motifId: 'star', x: 0.25, y: 0.75, scale: 1, rotation: 0 }]),
      options,
    );
    expect(svg).toContain(
      `translate(${(40 + 0.25 * 320).toFixed(2)} ${(150 + 0.75 * 208).toFixed(2)})`,
    );
  });
});

describe('shop artwork', () => {
  const key = 'custom/motifs/11111111-1111-4111-8111-111111111111.webp';
  const withPic = customOptionsSchema.parse({
    ...options,
    motifs: [{ id: 'pic', name: 'Ảnh', imageKey: key, priceVnd: 0 }],
  });
  it('requires every charm to have a shape or a picture and only accepts keys from our own upload', () => {
    expect(
      customOptionsSchema.safeParse({ ...options, motifs: [{ id: 'x', name: 'X', priceVnd: 0 }] })
        .success,
    ).toBe(false);
    expect(
      customOptionsSchema.safeParse({
        ...options,
        motifs: [{ id: 'x', name: 'X', imageKey: 'custom/motifs/../../a.webp', priceVnd: 0 }],
      }).success,
    ).toBe(false);
    expect(withPic.motifs[0]).toMatchObject({ path: null });
  });
  it('makes the canvas the picture itself, 400 units wide, whatever the picture size', () => {
    const wide = designArea({ width: 7500, height: 5250 });
    const tall = designArea({ width: 500, height: 1000 });
    expect(wide).toMatchObject({ left: 28, top: 28, width: 400, viewW: 456 });
    expect(wide.height / wide.width).toBeCloseTo(5250 / 7500, 2);
    expect(tall.height).toBe(800);
    expect(tall.viewH).toBe(800 + 28 + 64);
    expect(designArea(null).width).toBe(320); // the drawn hat
  });
  it('draws picture charms over the hat picture, masked to it, in their own colours', () => {
    const png = 'data:image/png;base64,AAAA';
    const svg = renderHatSvg(
      design([{ kind: 'MOTIF', motifId: 'pic', ...pos }]),
      withPic,
      () => null,
      'u',
      { hat: { href: png, width: 800, height: 600 }, motifHref: () => png },
    );
    expect(svg).toContain('mask="url(#u-hm)"');
    expect(svg).toContain('mask-type:alpha');
    expect(svg).toContain('viewBox="0 0 456 392"'); // the picture with a margin, widest underneath
    expect(svg).not.toContain('tint');
  });
  it('ignores pictures whose address is not an inline PNG/WebP/JPEG, a same-site path or https', () => {
    const svg = renderHatSvg(
      design([{ kind: 'MOTIF', motifId: 'pic', ...pos }]),
      withPic,
      () => null,
      'u',
      {
        hat: { href: 'javascript:alert(1)', width: 10, height: 10 },
        motifHref: () => 'http://evil.example/x.png',
      },
    );
    expect(svg).not.toContain('javascript:');
    expect(svg).not.toContain('evil.example');
    expect(svg).not.toContain('u-hm'); // fell back to the drawn hat
  });
});
