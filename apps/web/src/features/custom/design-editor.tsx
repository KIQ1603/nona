'use client';

import {
  CHARM_SLOTS,
  charmUnits,
  designArea,
  DESIGN_STATUS_LABELS,
  designSchema,
  formatVnd,
  priceDesign,
  bubbleGlyph,
  splitLetters,
  validateDesign,
  type CustomCatalog,
  type DesignAssetDto,
  type DesignDto,
  type LayerInput,
} from '@nona/contracts';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useToast } from '@/components/ui/toast';
import { useAction } from '@/features/account/use-action';
import { useCart } from '@/features/cart/cart-store';
import { useCustomer } from '@/lib/customer-client';
import { DesignPreview } from './design-preview';
import { sameSiteUrl } from '@/lib/media-url';
import { MotifThumb } from './grid-picker';

type Layer = LayerInput;
const POS = { x: 0.5, y: 0.5, scale: 1, rotation: 0 };

const fromDto = (d: DesignDto): Layer[] =>
  d.latest.layers.map((l) => {
    const pos = { x: l.x, y: l.y, scale: l.scale, rotation: l.rotation };
    if (l.kind === 'TEXT')
      return {
        kind: 'TEXT',
        text: l.text ?? '',
        fontId: l.fontId ?? 'serif',
        ...(l.colorId ? { colorId: l.colorId } : {}),
        ...pos,
      };
    if (l.kind === 'MOTIF')
      return {
        kind: 'MOTIF',
        motifId: l.motifId ?? '',
        ...(l.colorId ? { colorId: l.colorId } : {}),
        ...pos,
      };
    return { kind: 'IMAGE', assetId: l.assetId ?? '', ...pos };
  });

/**
 * The base hat is simply the product the customer came from. They decorate it and order straight away:
 * the design is saved, frozen and added to the cart in one step. Staff approval happens before production.
 */
export function DesignEditor({
  catalog,
  initial,
  preselect,
  allTypes,
}: {
  catalog: CustomCatalog;
  initial?: DesignDto;
  preselect?: { slug?: string; variantId?: string };
  /** Every product type of the shop: types without a designable product are shown as "Sắp ra mắt". */
  allTypes?: { slug: string; name: string }[];
}) {
  const { options, products } = catalog;
  const { request } = useCustomer();
  const { add } = useCart();
  const router = useRouter();
  const toast = useToast();
  const work = useAction();
  const [tab, setTab] = useState<'motif' | 'text' | 'color'>('motif');
  // colour given to the next sticker / letter (and to the selected layer when one is picked)
  const [colorId, setColorId] = useState(options.stickerColors[0]?.id ?? '');
  const [word, setWord] = useState('');
  // letters come in one style only: the candy letters of the shop's sticker sheet
  const fontId = 'bubble';
  const [showAllMotifs, setShowAllMotifs] = useState(false);

  const initialVariant = initial?.latest.variantId;
  const startProduct =
    products.find((p) => p.variants.some((v) => v.id === initialVariant)) ??
    products.find((p) => p.slug === preselect?.slug && p.variants.length) ??
    products.find((p) => p.variants.length) ??
    null;
  const [productSlug, setProductSlug] = useState<string | null>(startProduct?.slug ?? null);
  const product = products.find((p) => p.slug === productSlug) ?? null;
  const [variantId, setVariantId] = useState(
    initialVariant ??
      startProduct?.variants.find((v) => v.id === preselect?.variantId)?.id ??
      startProduct?.variants.find((v) => v.availability !== 'OUT_OF_STOCK')?.id ??
      startProduct?.variants[0]?.id ??
      '',
  );

  const [design, setDesign] = useState<DesignDto | null>(initial ?? null);
  const [layers, setLayers] = useState<Layer[]>(initial ? fromDto(initial) : []);
  const [selected, setSelected] = useState<number | null>(null);
  // Only the dashed frame + rotate knob follow the pointer outside the hat; the layer's settings panel stays,
  // otherwise the page would shift under the cursor and swallow clicks (e.g. on "Đặt hàng ngay").
  const [frame, setFrame] = useState(false);
  const pick = (i: number | null) => {
    setSelected(i);
    setFrame(i !== null);
  };
  const [assets, setAssets] = useState<DesignAssetDto[]>(initial?.assets ?? []);

  const status = design?.latest.status ?? 'DRAFT';
  const editable = status === 'DRAFT';
  const baseVariant = product?.variants.find((v) => v.id === variantId);

  const content = useMemo(
    () => ({ title: 'Nón thiết kế riêng', variantId, layers }),
    [variantId, layers],
  );
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const estimate = useMemo(() => priceDesign(content, options), [content, options]);
  const issues = useMemo(
    () => validateDesign(content, options, (id) => assets.find((a) => a.id === id)?.status ?? null),
    [content, options, assets],
  );
  const frozen = design?.latest.priceAdditionVnd ?? null;
  const total = (baseVariant?.priceVnd ?? 0) + (frozen ?? estimate.totalVnd);
  const priceLines = frozen === null ? estimate.lines : [];

  // The hat's colour is the selected variant's own picture (the shop attaches one per colour).
  const variantImage = baseVariant?.image ?? null;
  const hat = useMemo(
    () =>
      variantImage
        ? {
            href: sameSiteUrl(variantImage.url, origin),
            width: variantImage.width,
            height: variantImage.height,
          }
        : null,
    [variantImage, origin],
  );
  const motifSrc = useCallback(
    (key: string) => sameSiteUrl(`${catalog.mediaBase}/${key}`, origin),
    [catalog.mediaBase, origin],
  );
  const assetHref = useCallback(
    (id: string) =>
      assets.some((a) => a.id === id) ? `/api/custom-designs/assets/${id}/content` : null,
    [assets],
  );

  const setLayer = (i: number, patch: Partial<Layer>) =>
    setLayers((ls) => ls.map((l, j) => (j === i ? ({ ...l, ...patch } as Layer) : l)));
  const addLayer = (l: Layer) => {
    if (layers.length >= options.maxLayers)
      return toast(`Tối đa ${options.maxLayers} lớp thiết kế`);
    // stickers start in a free slot and are then dragged by the customer
    const stickers = layers.filter((x) => x.kind !== 'TEXT').length;
    const slot = CHARM_SLOTS[stickers % CHARM_SLOTS.length]!;
    setLayers([...layers, { ...l, x: slot.x, y: slot.y }]);
    pick(layers.length);
  };
  /** A typed word becomes one layer per letter, laid side by side and then dragged apart by the customer. */
  const addLetters = () => {
    const typed = splitLetters(word).slice(0, options.maxTextLength);
    // bubble letters exist for A-Z and 0-9: accents are dropped ("ằ" -> A) and anything else is left out
    const letters =
      fontId === 'bubble'
        ? typed.flatMap((c) => {
            const g = bubbleGlyph(c);
            return g ? [g.char] : [];
          })
        : typed;
    if (letters.length === 0)
      return toast('Chỉ gõ được chữ cái A–Z và số 0–9 với kiểu chữ kẹo bong bóng');
    if (letters.length < typed.length) toast('Một số ký tự không có sticker nên đã được bỏ qua');
    const room = options.maxLayers - layers.length;
    if (letters.length > room)
      return toast(
        room > 0
          ? `Chỉ còn chỗ cho ${room} lớp nữa (tối đa ${options.maxLayers} lớp)`
          : `Tối đa ${options.maxLayers} lớp thiết kế`,
      );
    const area = designArea(hat);
    const unit = charmUnits(
      options.letterHeightCm,
      product?.hatWidthCm,
      area,
      product?.hatHeightCm,
    );
    const step = unit / area.width; // a letter is about as wide as it is tall (bold capital) plus a small gap
    const start = 0.5 - (step * (letters.length - 1)) / 2;
    setLayers([
      ...layers,
      ...letters.map((text, i): Layer => ({
        kind: 'TEXT',
        text,
        fontId,
        colorId,
        x: Math.min(0.97, Math.max(0.03, start + step * i)),
        y: 0.5,
        scale: 1,
        rotation: 0,
      })),
    ]);
    pick(layers.length);
    setWord('');
  };
  /** Chooses a colour: it recolours the selected sticker or letter and becomes the colour of the next ones. */
  const chooseColor = (id: string) => {
    setColorId(id);
    const l = selected !== null ? layers[selected] : undefined;
    if (selected !== null && l && l.kind !== 'IMAGE') setLayer(selected, { colorId: id });
  };
  const moveLayer = (i: number, x: number, y: number) => setLayer(i, { x, y });
  const rotateTo = (i: number, deg: number) =>
    setLayer(i, { rotation: Math.max(-180, Math.min(180, Math.round(deg))) });

  const firstColor = options.stickerColors[0]?.id;
  const motifCount = (id: string, color?: string) =>
    layers.filter(
      (l) =>
        l.kind === 'MOTIF' && l.motifId === id && (!color || (l.colorId ?? firstColor) === color),
    ).length;
  const addMotif = (id: string, color?: string) =>
    addLayer({ kind: 'MOTIF', motifId: id, colorId: color ?? colorId, ...POS });
  const removeOneMotif = (id: string, color?: string) => {
    const at = layers
      .map(
        (l) =>
          l.kind === 'MOTIF' && l.motifId === id && (!color || (l.colorId ?? firstColor) === color),
      )
      .lastIndexOf(true);
    if (at >= 0) removeLayer(at);
  };
  const removeLayer = (i: number) => {
    setLayers(layers.filter((_, j) => j !== i));
    pick(null);
  };

  /** Save → freeze → add to cart. Returns once the design line is in the cart. */
  const order = async (goCheckout: boolean) => {
    const done = await work.run(async () => {
      let d = design;
      if (!d || d.latest.status === 'DRAFT') {
        const body = { variantId, layers };
        d = designSchema.parse(
          d
            ? await request<unknown>('PATCH', `/custom-designs/${d.id}`, body)
            : await request<unknown>('POST', '/custom-designs', body),
        );
        d = designSchema.parse(
          await request<unknown>('POST', `/custom-designs/${d.id}/submit`, {}),
        );
        setDesign(d);
        window.history.replaceState(null, '', `/thiet-ke-non/${d.id}`);
      }
      return (await add(variantId, 1, d.latest.id)) ? d : undefined;
    });
    if (!done) return;
    if (goCheckout) router.push('/thanh-toan');
    else toast('Đã thêm nón thiết kế vào giỏ hàng');
  };

  const onNewVersion = async () => {
    if (!design) return;
    const res = await work.run(() =>
      request<unknown>('POST', `/custom-designs/${design.id}/versions`, {}),
    );
    if (res) {
      const next = designSchema.parse(res);
      setDesign(next);
      setAssets(next.assets);
      setLayers(fromDto(next));
      toast('Bạn có thể chỉnh sửa thiết kế rồi đặt lại');
    }
  };

  useEffect(() => {
    if (!frame) return;
    // Clicking anywhere that is not a layer, its controls or the charm grid drops the selection (and its frame).
    const KEEP =
      '.drag-handle, .layer-editor, .layer-list, .charm-grid, .grid-picker-panel, .layer-add';
    const away = (e: MouseEvent) => !(e.target as Element).closest?.(KEEP) && setFrame(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [frame]);

  const baseOf = (p: (typeof products)[number]) =>
    (p.variants.find((v) => v.availability !== 'OUT_OF_STOCK') ?? p.variants[0])?.id ?? '';
  const chooseProduct = (slug: string) => {
    const p = products.find((x) => x.slug === slug);
    if (!p) return;
    setProductSlug(p.slug);
    setVariantId(baseOf(p));
  };
  // the product types the shop lets customers design on, in the shop's order (only types with a product)
  const types = useMemo(() => {
    const seen = new Map<
      string,
      { slug: string; name: string; image: string | null; soon: boolean }
    >();
    for (const t of allTypes ?? [])
      seen.set(t.slug, { slug: t.slug, name: t.name, image: null, soon: true });
    for (const p of products) {
      const t = p.type ?? { slug: '', name: 'Sản phẩm' };
      const old = seen.get(t.slug);
      if (!old) seen.set(t.slug, { ...t, image: p.imageUrl, soon: false });
      else if (old.soon) seen.set(t.slug, { ...old, image: p.imageUrl, soon: false });
    }
    return [...seen.values()];
  }, [products, allTypes]);
  const typeSlug = product?.type?.slug ?? '';
  const sameType = products.filter((p) => (p.type?.slug ?? '') === typeSlug);

  if (!product)
    return (
      <section className="dz-empty">
        <h2>Chưa có sản phẩm để thiết kế</h2>
        <p>Cửa hàng đang cập nhật, bạn quay lại sau nhé.</p>
      </section>
    );

  /** Hex of a palette colour for a thumbnail (null when the sticker keeps its own colours). */
  const colorLabel = (id?: string | null) =>
    (options.stickerColors.find((c) => c.id === id) ?? options.stickerColors[0])?.name ?? '';
  const activeColor =
    selected !== null && layers[selected] && layers[selected]!.kind !== 'IMAGE'
      ? ((layers[selected] as { colorId?: string }).colorId ?? options.stickerColors[0]?.id ?? '')
      : colorId;
  const sel = selected !== null ? layers[selected] : undefined;
  const motifName = (id: string) => options.motifs.find((m) => m.id === id)?.name ?? id;
  const layerName = (l: Layer) =>
    l.kind === 'TEXT'
      ? `Chữ “${l.text}” · ${colorLabel(l.colorId)}`
      : l.kind === 'MOTIF'
        ? `Sticker ${motifName(l.motifId)}${options.motifs.find((m) => m.id === l.motifId)?.tint === 'none' ? '' : ` · ${colorLabel(l.colorId)}`}`
        : 'Ảnh riêng';
  // identical layers (same sticker/letter in the same colour) are listed once with "×n"
  const layerGroups = (() => {
    const map = new Map<string, { key: string; indexes: number[] }>();
    layers.forEach((l, i) => {
      const key =
        l.kind === 'MOTIF'
          ? `m|${l.motifId}|${l.colorId ?? ''}`
          : l.kind === 'TEXT'
            ? `t|${l.text}|${l.colorId ?? ''}`
            : `i|${i}`;
      const g = map.get(key);
      if (g) g.indexes.push(i);
      else map.set(key, { key, indexes: [i] });
    });
    return [...map.values()];
  })();
  // the same extra (e.g. three pink stones) is one price line with "×3", not three identical lines
  const groupedPriceLines = (() => {
    const map = new Map<string, { label: string; count: number; amountVnd: number }>();
    for (const l of priceLines) {
      const label = l.label.replace(/^Họa tiết:/, 'Sticker:');
      const g = map.get(label);
      if (g) {
        g.count += 1;
        g.amountVnd += l.amountVnd;
      } else map.set(label, { label, count: 1, amountVnd: l.amountVnd });
    }
    return [...map.values()];
  })();
  const soldOut = baseVariant?.availability === 'OUT_OF_STOCK';
  const motifRows = showAllMotifs ? options.motifs : options.motifs.slice(0, 4);
  const canBuy = editable || status === 'SUBMITTED' || status === 'APPROVED';
  const blocked = work.pending || soldOut || (editable && issues.length > 0);

  return (
    <div className="dz">
      <header className="dz-head">
        <h1>Tự thiết kế sản phẩm</h1>
        <p>Thỏa sức sáng tạo, tạo nên sản phẩm mang dấu ấn riêng của bạn.</p>
      </header>

      <div className="dz-grid">
        <aside className="dz-types" aria-label="Chọn sản phẩm">
          <h2>Chọn sản phẩm</h2>
          <ul>
            {types.map((t) => (
              <li key={t.slug}>
                <button
                  type="button"
                  aria-pressed={t.slug === typeSlug}
                  disabled={!!design || t.soon}
                  onClick={() => {
                    const first = products.find((p) => (p.type?.slug ?? '') === t.slug);
                    if (first) chooseProduct(first.slug);
                  }}
                >
                  <span className="dz-type-img">
                    {t.image && <img src={t.image} alt="" loading="lazy" />}
                  </span>
                  <strong>{t.name}</strong>
                  {t.soon && <small>Sắp ra mắt</small>}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="dz-stage" aria-label="Xem trước">
          <DesignPreview
            layers={layers}
            options={options}
            assetHref={assetHref}
            hat={hat}
            hatWidthCm={product.hatWidthCm}
            hatHeightCm={product.hatHeightCm}
            motifHref={motifSrc}
            selected={frame ? selected : null}
            onSelect={editable ? pick : undefined}
            onMove={editable ? moveLayer : undefined}
            onRotate={editable ? rotateTo : undefined}
          />
          {sameType.length > 1 && (
            <ul className="dz-thumbs" aria-label={`Mẫu ${product.type?.name ?? ''}`}>
              {sameType.map((p) => (
                <li key={p.slug}>
                  <button
                    type="button"
                    aria-pressed={p.slug === product.slug}
                    aria-label={p.name}
                    title={p.name}
                    disabled={!!design}
                    onClick={() => chooseProduct(p.slug)}
                  >
                    {p.imageUrl && <img src={p.imageUrl} alt="" width={64} height={64} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="design-hint">
            <strong>{product.name}</strong> · {formatVnd(baseVariant?.priceVnd ?? 0)}. Bản xem trước
            minh họa; nghệ nhân sẽ thực hiện theo thiết kế của bạn.
          </p>
        </section>

        <section className="dz-panel" aria-label="Tùy chỉnh thiết kế">
          <h2>Tùy chỉnh thiết kế</h2>
          <div className="dz-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'motif'}
              onClick={() => setTab('motif')}
            >
              Sticker
            </button>
            {options.allowText && (
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'text'}
                onClick={() => setTab('text')}
              >
                Chữ
              </button>
            )}
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'color'}
              onClick={() => setTab('color')}
            >
              Màu sắc
            </button>
          </div>

          {!editable && (
            <p className="design-note" role="status">
              <span className={`pill pill-d-${status.toLowerCase()}`}>
                {DESIGN_STATUS_LABELS[status]}
              </span>{' '}
              {status === 'SUBMITTED' &&
                'Thiết kế đã được chốt. Nghệ nhân chỉ bắt đầu làm sau khi Sắc Chằm xác nhận thiết kế.'}
              {status === 'APPROVED' && 'Thiết kế đã được Sắc Chằm xác nhận.'}
              {status === 'REVISION_REQUIRED' && 'Sắc Chằm đề nghị bạn chỉnh sửa thiết kế.'}
              {design?.latest.reviewNote && (
                <>
                  <br />
                  <strong>Ghi chú từ Sắc Chằm:</strong> {design.latest.reviewNote}
                </>
              )}
            </p>
          )}

          <fieldset disabled={!editable} className="design-fields">
            {tab === 'motif' && (
              <>
                {options.motifs.length === 0 ? (
                  <p className="dz-muted">Cửa hàng chưa có sticker nào.</p>
                ) : (
                  <div className="dz-stickers">
                    {motifRows.map((m) => (
                      <section key={m.id} className="dz-sticker">
                        <header>
                          <strong>{m.name}</strong>
                          <small>
                            {m.priceVnd ? `+${formatVnd(m.priceVnd)} mỗi viên` : 'Miễn phí'}
                          </small>
                        </header>
                        <ul
                          className="dz-swatch-tiles"
                          role="group"
                          aria-label={`${m.name}: chọn màu`}
                        >
                          {(m.tint === 'none' ? [null] : options.stickerColors).map((c) => {
                            const n = motifCount(m.id, c?.id);
                            return (
                              <li key={c?.id ?? 'own'} className={n ? 'on' : ''}>
                                <button
                                  type="button"
                                  title={`${m.name} · ${c?.name ?? 'màu gốc'}`}
                                  aria-label={`Thêm ${m.name} màu ${c?.name ?? 'gốc'}`}
                                  onClick={() => addMotif(m.id, c?.id)}
                                >
                                  <span className="gp-preview">
                                    <MotifThumb motif={m} src={motifSrc} color={c?.hex ?? null} />
                                  </span>
                                  <small>{c?.name ?? 'Màu gốc'}</small>
                                </button>
                                {n > 0 && (
                                  <>
                                    <span className="charm-count" aria-label={`Đã chọn ${n}`}>
                                      ×{n}
                                    </span>
                                    <button
                                      type="button"
                                      className="charm-minus"
                                      aria-label={`Bỏ một ${m.name} màu ${c?.name ?? 'gốc'}`}
                                      onClick={() => removeOneMotif(m.id, c?.id)}
                                    >
                                      −
                                    </button>
                                  </>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      </section>
                    ))}
                  </div>
                )}
                {options.motifs.length > 4 && (
                  <button
                    type="button"
                    className="dz-more"
                    onClick={() => setShowAllMotifs(!showAllMotifs)}
                  >
                    {showAllMotifs ? 'Thu gọn' : 'Xem thêm'}
                  </button>
                )}
                <div className="charm-summary">
                  <span>
                    Đã chọn {layers.filter((l) => l.kind === 'MOTIF').length} sticker · kéo trực
                    tiếp trên sản phẩm để di chuyển
                  </span>
                  {layers.some((l) => l.kind === 'MOTIF') && (
                    <button
                      type="button"
                      className="admin-link-button"
                      onClick={() => {
                        setLayers(layers.filter((l) => l.kind !== 'MOTIF'));
                        pick(null);
                      }}
                    >
                      Bỏ tất cả
                    </button>
                  )}
                </div>
              </>
            )}

            {tab === 'text' && options.allowText && (
              <div className="dz-text">
                <label className="field">
                  <span>Gõ chữ — mỗi chữ cái là một sticker kẹo riêng</span>
                  <input
                    value={word}
                    maxLength={options.maxTextLength}
                    placeholder="VD: LAN"
                    onChange={(e) => setWord(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addLetters();
                      }
                    }}
                  />
                  <small>
                    Tối đa {options.maxTextLength} chữ một lần; chữ cao {options.letterHeightCm} cm
                    trên sản phẩm. Kéo từng chữ trên sản phẩm để đặt vị trí.
                    {options.textPriceVnd > 0 && ` Mỗi chữ +${formatVnd(options.textPriceVnd)}.`}
                  </small>
                </label>
                <div className="dz-swatches" role="group" aria-label="Màu chữ">
                  {options.stickerColors.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="dz-swatch"
                      aria-pressed={c.id === colorId}
                      aria-label={c.name}
                      title={c.name}
                      style={{ background: c.hex }}
                      onClick={() => setColorId(c.id)}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  className="dz-more"
                  disabled={splitLetters(word).length === 0}
                  onClick={addLetters}
                >
                  Thêm chữ lên sản phẩm
                </button>
              </div>
            )}

            {tab === 'color' && (
              <div className="dz-palette">
                <h3>Màu sticker và chữ</h3>
                <div className="dz-swatches" role="group" aria-label="Màu sticker và chữ">
                  {options.stickerColors.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className="dz-swatch"
                      aria-pressed={c.id === activeColor}
                      aria-label={c.name}
                      title={c.name}
                      style={{ background: c.hex }}
                      onClick={() => chooseColor(c.id)}
                    />
                  ))}
                </div>
                <p className="dz-muted">
                  {selected !== null && sel && sel.kind !== 'IMAGE'
                    ? `Đang chọn: ${layerName(sel)}. Bấm một màu để đổi màu lớp này.`
                    : 'Chọn một lớp trên sản phẩm để đổi màu, hoặc chọn màu cho sticker và chữ sắp thêm.'}
                </p>
                <h3>Mẫu / màu sản phẩm</h3>
              </div>
            )}

            {tab === 'color' &&
              (product.variants.length > 1 ? (
                <ul className="dz-tiles dz-colors" role="group" aria-label="Màu sắc / kiểu">
                  {product.variants.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        aria-pressed={v.id === variantId}
                        disabled={!editable || !!design || v.availability === 'OUT_OF_STOCK'}
                        onClick={() => setVariantId(v.id)}
                      >
                        <span className="gp-preview">
                          {v.image && (
                            <img src={sameSiteUrl(v.image.url, origin)} alt="" loading="lazy" />
                          )}
                        </span>
                        <span>{v.name}</span>
                        <small>
                          {v.availability === 'OUT_OF_STOCK' ? 'Hết hàng' : formatVnd(v.priceVnd)}
                        </small>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dz-muted">Sản phẩm này chỉ có một màu.</p>
              ))}

            {layers.length > 0 && (
              <div className="field dz-layers">
                <span>
                  Đã chọn ({layers.length}/{options.maxLayers})
                </span>
                <ol className="layer-list">
                  {layerGroups.map((g) => {
                    const at = selected !== null ? g.indexes.indexOf(selected) : -1;
                    return (
                      <li key={g.key} className={at >= 0 ? 'active' : ''}>
                        <button
                          type="button"
                          className="layer-name"
                          // each click moves on to the next one of the same kind
                          onClick={() => pick(g.indexes[(at + 1) % g.indexes.length]!)}
                        >
                          {layerName(layers[g.indexes[0]!]!)}
                          {g.indexes.length > 1 && (
                            <b className="layer-times"> ×{g.indexes.length}</b>
                          )}
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={g.indexes.length > 1 ? 'Bỏ một cái' : 'Xóa'}
                          onClick={() => removeLayer(g.indexes[g.indexes.length - 1]!)}
                        >
                          ✕
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </fieldset>

          <dl className="design-price">
            <div>
              <dt>{product.name}</dt>
              <dd>{formatVnd(baseVariant?.priceVnd ?? 0)}</dd>
            </div>
            {groupedPriceLines.map((l) => (
              <div key={l.label}>
                <dt>
                  {l.label}
                  {l.count > 1 && <b className="layer-times"> ×{l.count}</b>}
                </dt>
                <dd>+{formatVnd(l.amountVnd)}</dd>
              </div>
            ))}
            {frozen !== null && (
              <div>
                <dt>Phụ thu thiết kế</dt>
                <dd>+{formatVnd(frozen)}</dd>
              </div>
            )}
            <div className="grand">
              <dt>Giá mỗi sản phẩm</dt>
              <dd>{formatVnd(total)}</dd>
            </div>
          </dl>
        </section>
      </div>

      {editable && issues.length > 0 && (
        <ul className="issue-list" role="alert">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}
      {work.error && (
        <p className="form-error" role="alert">
          {work.error}
        </p>
      )}

      <div className="dz-bottom">
        <div className="dz-note">
          <strong>Lưu ý</strong>
          <p>
            {options.note ||
              'Sản phẩm được nghệ nhân làm thủ công theo thiết kế của bạn nên có thể chênh lệch nhỏ so với bản xem trước.'}
            {options.requireApproval ? ' Sắc Chằm sẽ xác nhận thiết kế trước khi bắt đầu làm.' : ''}
          </p>
        </div>
        <div className="dz-actions">
          {canBuy && (
            <>
              <button
                type="button"
                className="dz-cart"
                disabled={blocked}
                onClick={() => void order(false)}
              >
                <span aria-hidden="true">🛒</span> {soldOut ? 'Hết hàng' : 'Thêm vào giỏ hàng'}
              </button>
              <button
                type="button"
                className="dz-buy"
                disabled={blocked}
                onClick={() => void order(true)}
              >
                Đặt hàng ngay
              </button>
            </>
          )}
          {(status === 'APPROVED' || status === 'REVISION_REQUIRED') && (
            <button
              type="button"
              className="dz-cart"
              disabled={work.pending}
              onClick={() => void onNewVersion()}
            >
              Chỉnh sửa (phiên bản mới)
            </button>
          )}
          <Link className="dz-new" href="/thiet-ke-non">
            Thiết kế mới
          </Link>
        </div>
      </div>
    </div>
  );
}
