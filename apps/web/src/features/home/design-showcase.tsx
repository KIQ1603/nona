import { designArea, renderHatSvg, type CustomCatalog, type LayerInput } from '@nona/contracts';
import Link from 'next/link';
import { SITE_URL } from '@/lib/env';
import { sameSiteUrl } from '@/lib/media-url';

/** Where the three demo stickers sit: spread over the middle of the product so they are easy to see. */
const SHOWCASE_SLOTS = [
  { x: 0.34, y: 0.62 },
  { x: 0.52, y: 0.42 },
  { x: 0.68, y: 0.64 },
] as const;

/**
 * "Tự thiết kế" banner: the same product before and after the customer picks stickers. Both pictures are drawn
 * by the designer's own renderer from the shop's real product picture, stickers and colours (admin-managed), so
 * they always match what the designer produces. Renders nothing while the designer is switched off.
 */
export function DesignShowcase({ catalog }: { catalog: CustomCatalog | null }) {
  if (!catalog || !catalog.options.enabled) return null;
  const product = catalog.products.find((p) => p.variants.length > 0);
  if (!product) return null;
  const { options } = catalog;
  const origin = new URL(SITE_URL).origin;
  const variant = product.variants.find((v) => v.image) ?? product.variants[0]!;
  const hat = variant.image
    ? {
        href: sameSiteUrl(variant.image.url, origin),
        width: variant.image.width,
        height: variant.image.height,
      }
    : null;
  const colors = options.stickerColors;
  const layers: LayerInput[] = options.motifs.slice(0, 3).map((m, i) => ({
    kind: 'MOTIF',
    motifId: m.id,
    colorId: colors[(i * 2 + 1) % colors.length]?.id,
    x: SHOWCASE_SLOTS[i]!.x,
    y: SHOWCASE_SLOTS[i]!.y,
    scale: 1,
    rotation: 0,
  }));
  // a short word in candy letters next to the stickers, when the shop lets customers add letters
  if (options.allowText)
    ['C', 'H', 'A', 'M'].forEach((text, i) =>
      layers.push({
        kind: 'TEXT',
        text,
        fontId: 'bubble',
        colorId: colors[(i + 1) % colors.length]?.id,
        x: 0.32 + i * 0.12,
        y: 0.5,
        scale: 1,
        rotation: (i % 2 ? 1 : -1) * 5,
      }),
    );
  const extras = {
    hat,
    hatWidthCm: product.hatWidthCm,
    hatHeightCm: product.hatHeightCm,
    transparentBackground: true,
    motifHref: (key: string) => sameSiteUrl(`${catalog.mediaBase}/${key}`, origin),
  };
  const before = renderHatSvg({ layers: [] }, options, () => null, 'sb', extras);
  const after = renderHatSvg({ layers }, options, () => null, 'sa', extras);
  // keep the frame as tall as the drawing needs
  const ratio = hat ? designArea(hat).viewH / designArea(hat).viewW : 500 / 400;

  return (
    <section className="hm-design" aria-labelledby="hm-design-title">
      <div className="hm-design-copy">
        <p className="hm-kicker">Sắc Chằm Custom</p>
        <h2 id="hm-design-title">Tự thiết kế, tạo dấu ấn của riêng bạn</h2>
        <p>
          Chọn sản phẩm, gắn sticker, đổi màu pastel và thêm chữ của riêng bạn. Nghệ nhân sẽ chằm
          đúng thiết kế ấy thành một món độc bản.
        </p>
        <Link className="hm-cta" href="/thiet-ke-non">
          Tạo dấu ấn của riêng bạn
        </Link>
      </div>
      <div className="hm-design-demo" style={{ '--ratio': ratio } as React.CSSProperties}>
        <figure>
          <div
            role="img"
            aria-label="Sản phẩm trước khi thiết kế"
            dangerouslySetInnerHTML={{ __html: before }}
          />
          <figcaption>Trước</figcaption>
        </figure>
        <span aria-hidden="true">→</span>
        <figure>
          <div
            role="img"
            aria-label="Sản phẩm sau khi chọn họa tiết"
            dangerouslySetInnerHTML={{ __html: after }}
          />
          <figcaption>Sau khi chọn họa tiết</figcaption>
        </figure>
      </div>
    </section>
  );
}
