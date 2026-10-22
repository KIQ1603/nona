import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { AppError } from '../../../common/errors/app-error';

const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_MIN_SIDE = 400;
const MAX_SIDE = 1600;
const ALLOWED = new Set(['jpeg', 'png', 'webp']);

export interface ProcessedImage {
  body: Buffer;
  contentType: 'image/webp';
  width: number;
  height: number;
}

/**
 * Trusts bytes, not client claims: the real format and dimensions are detected by decoding.
 * Output is re-encoded (drops EXIF/GPS, scripts and polyglot payloads) and bounded in size.
 */
@Injectable()
export class ImageProcessor {
  async process(
    input: Buffer,
    options: { minSide?: number; maxSide?: number } = {},
  ): Promise<ProcessedImage> {
    const minSide = options.minSide ?? DEFAULT_MIN_SIDE;
    const maxSide = options.maxSide ?? MAX_SIDE;
    if (input.length === 0 || input.length > MAX_BYTES) {
      throw new AppError('MEDIA_INVALID', 400, 'Ảnh phải có dung lượng tối đa 8MB.');
    }
    try {
      const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' });
      const meta = await image.metadata();
      if (!meta.format || !ALLOWED.has(meta.format)) {
        throw new AppError('MEDIA_INVALID', 400, 'Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP.');
      }
      const { data, info } = await image
        .rotate()
        .resize({ width: maxSide, height: maxSide, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      if (Math.min(info.width, info.height) < minSide) {
        throw new AppError(
          'MEDIA_INVALID',
          400,
          `Ảnh quá nhỏ: mỗi cạnh cần tối thiểu ${minSide}px.`,
        );
      }
      return { body: data, contentType: 'image/webp', width: info.width, height: info.height };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('MEDIA_INVALID', 400, 'Tệp không phải ảnh hợp lệ.');
    }
  }

  /**
   * Admin-supplied artwork (charms/icons). Accepts SVG or PNG/WebP/JPEG of any size and normalises it
   * to a small, trimmed, square, transparent WebP: huge files are shrunk, margins removed, scripts and
   * external references in SVG are refused before anything is rendered.
   */
  async processCharm(input: Buffer): Promise<ArtworkImage> {
    const img = await this.normalise(input, { svgMaxBytes: SVG_MAX_BYTES });
    const SIZE = 256;
    const trimmed = await this.trimmed(img);
    const transparent = await hasTransparency(trimmed);
    // Keep the picture's own proportions (no square padding): the admin sets the real width and height in cm.
    const { data, info } = await sharp(trimmed)
      .resize({ width: SIZE, height: SIZE, fit: 'inside' })
      .webp({ quality: 90, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    return {
      body: data,
      contentType: 'image/webp',
      width: info.width,
      height: info.height,
      transparent,
    };
  }

  /**
   * Product pictures supplied by the shop (SVG or raster): kept whole (no trimming, so a flat-coloured
   * hat is allowed), bounded to 1600px and re-encoded as WebP.
   */
  async processGallery(
    input: Buffer,
    options: { fitToHat?: boolean } = {},
  ): Promise<ProcessedImage> {
    let img = await this.normalise(input, { svgMaxBytes: SVG_MAX_BYTES });
    if (options.fitToHat) img = await this.cutOut(img);
    const { data, info } = await sharp(img)
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    // a cut-out hat can legitimately be smaller than a full photo
    const min = options.fitToHat ? 200 : DEFAULT_MIN_SIDE;
    if (Math.max(info.width, info.height) < min)
      throw new AppError('MEDIA_INVALID', 400, `Ảnh quá nhỏ: cạnh dài cần tối thiểu ${min}px.`);
    return { body: data, contentType: 'image/webp', width: info.width, height: info.height };
  }

  /**
   * Prepares a hat picture for designing on: a flat studio background (all four corners the same colour)
   * is made transparent from the edges inwards, then the empty margins are trimmed so the picture's box is
   * the hat itself. Pictures that are already transparent are only trimmed; a picture that cannot be
   * trimmed (one flat colour) is used as is.
   */
  private async cutOut(png: Buffer): Promise<Buffer> {
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const { width: w, height: h } = info;
    const px = (x: number, y: number) => (y * w + x) * 4;
    const corners = [px(0, 0), px(w - 1, 0), px(0, h - 1), px(w - 1, h - 1)];
    const opaque = corners.every((i) => data[i + 3]! > 250);
    if (opaque) {
      const bg = [data[corners[0]!]!, data[corners[0]! + 1]!, data[corners[0]! + 2]!];
      const near = (i: number, tol: number) =>
        Math.abs(data[i]! - bg[0]!) +
          Math.abs(data[i + 1]! - bg[1]!) +
          Math.abs(data[i + 2]! - bg[2]!) <=
        tol;
      if (corners.every((i) => near(i, 30))) {
        const seen = new Uint8Array(w * h);
        const stack: number[] = [];
        const push = (x: number, y: number) => {
          if (x < 0 || y < 0 || x >= w || y >= h || seen[y * w + x]) return;
          if (!near(px(x, y), 36)) return;
          seen[y * w + x] = 1;
          stack.push(x, y);
        };
        for (let x = 0; x < w; x++) (push(x, 0), push(x, h - 1));
        for (let y = 0; y < h; y++) (push(0, y), push(w - 1, y));
        while (stack.length) {
          const y = stack.pop()!;
          const x = stack.pop()!;
          data[px(x, y) + 3] = 0;
          push(x + 1, y);
          push(x - 1, y);
          push(x, y + 1);
          push(x, y - 1);
        }
      }
    }
    // trim the empty (transparent) margins: the picture's box becomes the hat's box
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (data[px(x, y) + 3]! > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX < 0 || (minX === 0 && minY === 0 && maxX === w - 1 && maxY === h - 1)) return png;
    return sharp(data, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
      .png()
      .toBuffer();
  }

  /** The shop's picture of a plain hat: trimmed to the hat so layer coordinates map onto the hat itself. */
  async processBase(input: Buffer): Promise<ArtworkImage> {
    const img = await this.normalise(input, { svgMaxBytes: SVG_MAX_BYTES });
    const trimmed = await this.trimmed(img);
    const transparent = await hasTransparency(trimmed);
    const { data, info } = await sharp(trimmed)
      .resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 88, alphaQuality: 100 })
      .toBuffer({ resolveWithObject: true });
    if (Math.max(info.width, info.height) < 200)
      throw new AppError('MEDIA_INVALID', 400, 'Ảnh nón quá nhỏ: cạnh dài cần tối thiểu 200px.');
    return {
      body: data,
      contentType: 'image/webp',
      width: info.width,
      height: info.height,
      transparent,
    };
  }

  /** Decodes any accepted format into an RGBA PNG buffer (SVG is sanitised, then rasterised). */
  private async normalise(input: Buffer, o: { svgMaxBytes: number }): Promise<Buffer> {
    if (input.length === 0 || input.length > MAX_BYTES)
      throw new AppError('MEDIA_INVALID', 400, 'Tệp phải có dung lượng tối đa 8MB.');
    try {
      const svg = looksLikeSvg(input);
      if (svg) {
        if (input.length > o.svgMaxBytes)
          throw new AppError('MEDIA_INVALID', 400, 'Tệp SVG quá lớn (tối đa 300KB).');
        const problem = svgProblem(input.toString('utf8'));
        if (problem) throw new AppError('MEDIA_INVALID', 400, problem);
        return await sharp(input, { density: 288, limitInputPixels: 40_000_000 })
          .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: false })
          .ensureAlpha()
          .png()
          .toBuffer();
      }
      const image = sharp(input, { limitInputPixels: 40_000_000, failOn: 'error' });
      const meta = await image.metadata();
      if (!meta.format || !ALLOWED.has(meta.format))
        throw new AppError('MEDIA_INVALID', 400, 'Chỉ chấp nhận SVG, PNG, WebP hoặc JPEG.');
      return await image
        .rotate()
        .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
        .ensureAlpha()
        .png()
        .toBuffer();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('MEDIA_INVALID', 400, 'Tệp không phải ảnh hợp lệ.');
    }
  }

  /** Removes empty margins (transparent or uniform background); a blank image is refused. */
  private async trimmed(png: Buffer): Promise<Buffer> {
    const blank = () => new AppError('MEDIA_INVALID', 400, 'Ảnh trống hoặc chỉ có một màu.');
    let out: Buffer;
    try {
      out = await sharp(png).trim({ threshold: 12 }).png().toBuffer();
    } catch {
      throw blank();
    }
    const [meta, stats] = await Promise.all([sharp(out).metadata(), sharp(out).stats()]);
    const alpha = stats.channels[3];
    const uniform = stats.channels.every((c) => c.stdev < 1.5); // one flat colour: nothing to place
    if ((meta.width ?? 0) < 3 || (meta.height ?? 0) < 3 || !alpha || alpha.max < 8 || uniform)
      throw blank();
    return out;
  }
}

export interface ArtworkImage extends ProcessedImage {
  /** False when the picture has no transparent pixels (e.g. a JPEG): its background will show. */
  transparent: boolean;
}

const SVG_MAX_BYTES = 300 * 1024;

const looksLikeSvg = (b: Buffer) =>
  /^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
    b.subarray(0, 2048).toString('utf8'),
  );

/**
 * SVG can carry scripts and references to other files/URLs. We never need them for artwork, so anything
 * beyond plain shapes is refused outright (nothing is "cleaned up"), before the file reaches a renderer.
 */
export function svgProblem(svg: string): string | null {
  const bad: [RegExp, string][] = [
    [/<!DOCTYPE|<!ENTITY/i, 'SVG chứa khai báo không được phép (DOCTYPE/ENTITY).'],
    [/<\s*script/i, 'SVG không được chứa script.'],
    [/<\s*foreignObject/i, 'SVG không được chứa foreignObject.'],
    [
      /<\s*(image|iframe|embed|object|audio|video)\b/i,
      'SVG không được nhúng ảnh hoặc nội dung ngoài; hãy chuyển chữ/ảnh thành hình vẽ (path).',
    ],
    [/\son[a-z]+\s*=/i, 'SVG không được chứa sự kiện (onclick…).'],
    [/(?:xlink:)?href\s*=\s*["'](?!#)/i, 'SVG không được tham chiếu tệp hoặc địa chỉ ngoài.'],
    [/url\(\s*["']?\s*(?!#)/i, 'SVG không được dùng url() tới nội dung ngoài.'],
    [/@import|javascript:|data:/i, 'SVG chứa nội dung không được phép.'],
  ];
  for (const [re, message] of bad) if (re.test(svg)) return message;
  return null;
}

async function hasTransparency(png: Buffer): Promise<boolean> {
  const stats = await sharp(png).stats();
  const alpha = stats.channels[3];
  return Boolean(alpha && alpha.min < 250);
}
