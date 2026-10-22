'use client';

import { Dropdown } from '@/components/ui/dropdown';
import {
  CHARM_SLOTS,
  DESIGN_FONTS,
  DESIGN_STATUS_LABELS,
  designSchema,
  formatVnd,
  priceDesign,
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
import { GridPicker, MotifThumb, Swatch } from './grid-picker';

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
        ...pos,
      };
    if (l.kind === 'MOTIF') return { kind: 'MOTIF', motifId: l.motifId ?? '', ...pos };
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
}: {
  catalog: CustomCatalog;
  initial?: DesignDto;
  preselect?: { slug?: string; variantId?: string };
}) {
  const { options, products } = catalog;
  const { request } = useCustomer();
  const { add } = useCart();
  const router = useRouter();
  const toast = useToast();
  const work = useAction();

  const initialVariant = initial?.latest.variantId;
  const startProduct =
    products.find((p) => p.variants.some((v) => v.id === initialVariant)) ??
    products.find((p) => p.slug === preselect?.slug && p.variants.length) ??
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
    // text lines are staggered; charms start in a free slot and are then dragged by the customer
    const charms = layers.filter((x) => x.kind !== 'TEXT').length;
    const slot = CHARM_SLOTS[charms % CHARM_SLOTS.length]!;
    setLayers([
      ...layers,
      l.kind === 'TEXT'
        ? { ...l, y: 0.4 + 0.18 * (layers.length % 4) }
        : { ...l, x: slot.x, y: slot.y },
    ]);
    pick(layers.length);
  };
  const moveLayer = (i: number, x: number, y: number) => setLayer(i, { x, y });
  const rotateTo = (i: number, deg: number) =>
    setLayer(i, { rotation: Math.max(-180, Math.min(180, Math.round(deg))) });

  const motifCount = (id: string) =>
    layers.filter((l) => l.kind === 'MOTIF' && l.motifId === id).length;
  const addMotif = (id: string) => addLayer({ kind: 'MOTIF', motifId: id, ...POS });
  const removeOneMotif = (id: string) => {
    const at = layers.map((l) => l.kind === 'MOTIF' && l.motifId === id).lastIndexOf(true);
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

  // ---- step 0: no base hat yet (opened /thiet-ke-non directly) ----
  if (!product)
    return (
      <section className="design-chooser">
        <h2>Chọn chiếc nón để bắt đầu</h2>
        <ul className="design-cards">
          {products.map((p) => (
            <li key={p.slug}>
              <button
                type="button"
                onClick={() => {
                  setProductSlug(p.slug);
                  setVariantId(
                    (p.variants.find((v) => v.availability !== 'OUT_OF_STOCK') ?? p.variants[0])
                      ?.id ?? '',
                  );
                }}
              >
                {p.imageUrl && (
                  <img src={p.imageUrl} alt="" width={160} height={200} loading="lazy" />
                )}
                <strong>{p.name}</strong>
                <small>Từ {formatVnd(Math.min(...p.variants.map((v) => v.priceVnd)))}</small>
              </button>
            </li>
          ))}
        </ul>
      </section>
    );

  const sel = selected !== null ? layers[selected] : undefined;
  const motifName = (id: string) => options.motifs.find((m) => m.id === id)?.name ?? id;
  const layerName = (l: Layer) =>
    l.kind === 'TEXT'
      ? `Chữ “${l.text}”`
      : l.kind === 'MOTIF'
        ? `Họa tiết ${motifName(l.motifId)}`
        : 'Ảnh riêng';
  const soldOut = baseVariant?.availability === 'OUT_OF_STOCK';

  return (
    <div className="design-page">
      <div className="design-stage">
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
        <p className="design-hint">
          Bản xem trước minh họa; nghệ nhân sẽ thực hiện theo thiết kế của bạn.
        </p>
      </div>

      <div className="design-panel">
        <div className="design-base">
          {product.imageUrl && <img src={product.imageUrl} alt="" width={64} height={80} />}
          <div>
            <small>Nón nền</small>
            <strong>{product.name}</strong>
            {editable && !design && (
              <button
                type="button"
                className="admin-link-button"
                onClick={() => setProductSlug(null)}
              >
                Chọn nón khác
              </button>
            )}
          </div>
          <span className="design-base-price">{formatVnd(baseVariant?.priceVnd ?? 0)}</span>
        </div>
        {product.variants.length > 1 && (
          <div className="field">
            <span>Màu / size</span>
            <div className="variant-pills" role="group" aria-label="Màu / size">
              {product.variants.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  aria-pressed={v.id === variantId}
                  disabled={!editable || !!design || v.availability === 'OUT_OF_STOCK'}
                  onClick={() => setVariantId(v.id)}
                >
                  {v.image && (
                    <img
                      src={sameSiteUrl(v.image.url, origin)}
                      alt=""
                      width={28}
                      height={28}
                      className="variant-thumb"
                    />
                  )}
                  {v.name} · {formatVnd(v.priceVnd)}
                </button>
              ))}
            </div>
          </div>
        )}

        {!editable && (
          <p className="design-note" role="status">
            <span className={`pill pill-d-${status.toLowerCase()}`}>
              {DESIGN_STATUS_LABELS[status]}
            </span>{' '}
            {status === 'SUBMITTED' &&
              'Thiết kế đã được chốt. Nghệ nhân chỉ bắt đầu làm sau khi NONA xác nhận thiết kế.'}
            {status === 'APPROVED' && 'Thiết kế đã được NONA xác nhận.'}
            {status === 'REVISION_REQUIRED' && 'NONA đề nghị bạn chỉnh sửa thiết kế.'}
            {design?.latest.reviewNote && (
              <>
                <br />
                <strong>Ghi chú từ NONA:</strong> {design.latest.reviewNote}
              </>
            )}
          </p>
        )}

        <fieldset disabled={!editable} className="design-fields">
          {options.motifs.length > 0 && (
            <div className="field">
              <span>Họa tiết / charm — bấm để thêm, có thể chọn nhiều</span>
              <ul className="charm-grid">
                {options.motifs.map((m) => {
                  const n = motifCount(m.id);
                  return (
                    <li key={m.id} className={`charm-tile${n ? ' on' : ''}`}>
                      <button type="button" className="pick" onClick={() => addMotif(m.id)}>
                        <span className="gp-preview">
                          <MotifThumb motif={m} src={motifSrc} />
                        </span>
                        <span>{m.name}</span>
                        <small>{m.priceVnd ? `+${formatVnd(m.priceVnd)}` : 'Miễn phí'}</small>
                      </button>
                      {n > 0 && (
                        <>
                          <span className="charm-count" aria-label={`Đã chọn ${n}`}>
                            ×{n}
                          </span>
                          <button
                            type="button"
                            className="charm-minus"
                            aria-label={`Bỏ một ${m.name}`}
                            onClick={() => removeOneMotif(m.id)}
                          >
                            −
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="charm-summary">
                <span>
                  Đã chọn {layers.filter((l) => l.kind === 'MOTIF').length} họa tiết · kéo trực tiếp
                  trên nón để di chuyển
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
            </div>
          )}

          <div className="field">
            <span>
              Họa tiết đã chọn ({layers.length}/{options.maxLayers})
            </span>
            {layers.length === 0 && (
              <small>
                Chưa chọn charm nào. Bấm một charm ở trên rồi kéo trên nón để đặt vị trí.
              </small>
            )}
            <ol className="layer-list">
              {layers.map((l, i) => (
                <li key={i} className={selected === i ? 'active' : ''}>
                  <button type="button" className="layer-name" onClick={() => pick(i)}>
                    {layerName(l)}
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Xóa lớp"
                    onClick={() => removeLayer(i)}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>
          </div>

          {sel && selected !== null && (
            <div className="layer-editor">
              {sel.kind === 'TEXT' && (
                <>
                  <label className="field">
                    <span>Nội dung (tối đa {options.maxTextLength} ký tự)</span>
                    <input
                      value={sel.text}
                      maxLength={options.maxTextLength}
                      onChange={(e) => setLayer(selected, { text: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>Kiểu chữ</span>
                    <Dropdown
                      ariaLabel="Kiểu chữ"
                      value={sel.fontId}
                      onChange={(v) => setLayer(selected, { fontId: v })}
                      options={DESIGN_FONTS.map((f) => ({ value: f.id, label: f.label }))}
                    />
                  </label>
                </>
              )}
              {sel.kind === 'MOTIF' && (
                <div className="field">
                  <span>Họa tiết (biểu tượng)</span>
                  <GridPicker
                    label="Họa tiết"
                    value={sel.motifId}
                    onChange={(id) => setLayer(selected, { motifId: id })}
                    options={options.motifs.map((m) => ({
                      id: m.id,
                      name: m.name,
                      priceVnd: m.priceVnd,
                      preview: <MotifThumb motif={m} src={motifSrc} />,
                    }))}
                  />
                </div>
              )}
              {sel.kind === 'TEXT' && (
                <>
                  <Slider
                    label="Ngang"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sel.x}
                    onChange={(v) => setLayer(selected, { x: v })}
                  />
                  <Slider
                    label="Dọc"
                    min={0}
                    max={1}
                    step={0.01}
                    value={sel.y}
                    onChange={(v) => setLayer(selected, { y: v })}
                  />
                  <Slider
                    label="Kích thước"
                    min={0.2}
                    max={3}
                    step={0.05}
                    value={sel.scale}
                    onChange={(v) => setLayer(selected, { scale: v })}
                  />
                </>
              )}
            </div>
          )}
        </fieldset>

        <dl className="design-price">
          <div>
            <dt>Nón nền</dt>
            <dd>{formatVnd(baseVariant?.priceVnd ?? 0)}</dd>
          </div>
          {priceLines.map((l, i) => (
            <div key={`${l.label}-${i}`}>
              <dt>{l.label}</dt>
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
            <dt>Giá mỗi chiếc</dt>
            <dd>{formatVnd(total)}</dd>
          </div>
        </dl>

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

        <div className="design-actions">
          {(editable || status === 'SUBMITTED' || status === 'APPROVED') && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={work.pending || soldOut || (editable && issues.length > 0)}
                onClick={() => void order(true)}
              >
                {soldOut ? 'Hết hàng' : 'Đặt hàng ngay'}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                disabled={work.pending || soldOut || (editable && issues.length > 0)}
                onClick={() => void order(false)}
              >
                Thêm vào giỏ
              </button>
            </>
          )}
          {(status === 'APPROVED' || status === 'REVISION_REQUIRED') && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={work.pending}
              onClick={() => void onNewVersion()}
            >
              Chỉnh sửa (phiên bản mới)
            </button>
          )}
          <Link className="btn btn-soft" href="/thiet-ke-non">
            Thiết kế mới
          </Link>
        </div>
      </div>
    </div>
  );
}

function Slider({
  label,
  ...p
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field slider">
      <span>{label}</span>
      <input
        type="range"
        min={p.min}
        max={p.max}
        step={p.step}
        value={p.value}
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    </label>
  );
}
