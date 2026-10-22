'use client';

import {
  charmBox,
  charmUnits,
  designArea,
  renderHatSvg,
  type CustomOptions,
  type HatImage,
  type LayerInput,
} from '@nona/contracts';
import { useId, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';

const clamp = (v: number) => Math.min(1, Math.max(0, v));

/**
 * Live preview: the SAME renderer the server uses for the stored preview image. When editable, each
 * layer gets an invisible drag handle on top so the customer can move it directly on the hat.
 */
export function DesignPreview({
  layers,
  options,
  assetHref,
  selected = null,
  onSelect,
  onMove,
  onRotate,
  hat = null,
  hatWidthCm,
  hatHeightCm,
  motifHref,
}: {
  layers: LayerInput[];
  options: CustomOptions;
  assetHref: (assetId: string) => string | null;
  selected?: number | null;
  onSelect?: (index: number) => void;
  onMove?: (index: number, x: number, y: number) => void;
  onRotate?: (index: number, degrees: number) => void;
  /** The shop's own picture of this hat, if it has one. */
  hat?: HatImage | null;
  /** Real width of the hat in cm: sizes charms in proportion. */
  hatWidthCm?: number | null;
  hatHeightCm?: number | null;
  motifHref?: (imageKey: string) => string | null;
}) {
  const area = designArea(hat);
  const uid = `p${useId().replace(/[^a-z0-9]/gi, '')}`;
  const box = useRef<HTMLDivElement>(null);
  const svg = useMemo(
    () =>
      renderHatSvg({ layers }, options, assetHref, uid, {
        hat,
        motifHref,
        hatWidthCm,
        hatHeightCm,
      }),
    [layers, options, assetHref, uid, hat, motifHref, hatWidthCm, hatHeightCm],
  );

  const drag = (i: number, e: PointerEvent<HTMLButtonElement>) => {
    if (!onMove || e.buttons === 0) return;
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const vx = ((e.clientX - r.left) / r.width) * area.viewW;
    const vy = ((e.clientY - r.top) / r.height) * area.viewH;
    onMove(i, clamp((vx - area.left) / area.width), clamp((vy - area.top) / area.height));
  };
  /** Drag the knob above a layer: the layer turns to point at the pointer (0° = knob straight up). */
  const turn = (i: number, e: PointerEvent<HTMLSpanElement>) => {
    if (!onRotate || e.buttons === 0) return;
    const handle = e.currentTarget.parentElement?.getBoundingClientRect();
    if (!handle) return;
    const dx = e.clientX - (handle.left + handle.width / 2);
    const dy = e.clientY - (handle.top + handle.height / 2);
    onRotate(i, (Math.atan2(dx, -dy) * 180) / Math.PI);
  };
  const nudge = (i: number, l: LayerInput, e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 0.05 : 0.01;
    const d = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[e.key];
    if (!d || !onMove) return;
    e.preventDefault();
    onMove(i, clamp(l.x + d[0]!), clamp(l.y + d[1]!));
  };

  // renderHatSvg escapes/validates every dynamic value (see contracts/design.ts), so injecting is safe.
  return (
    <div className="design-preview" ref={box}>
      <div
        role="img"
        aria-label="Xem trước chiếc nón của bạn"
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {onMove &&
        layers.map((l, i) => {
          const box =
            l.kind === 'MOTIF'
              ? charmBox(
                  options.motifs.find((m) => m.id === l.motifId) ?? { sizeCm: 10 },
                  hatWidthCm,
                  area,
                  hatHeightCm,
                )
              : {
                  w: charmUnits(options.imageSizeCm, hatWidthCm, area, hatHeightCm),
                  h: charmUnits(options.imageSizeCm, hatWidthCm, area, hatHeightCm),
                };
          const w = l.kind === 'TEXT' ? Math.max(40, l.text.length * 15 * l.scale) : box.w;
          const h = l.kind === 'TEXT' ? 34 * l.scale : box.h;
          return (
            <button
              key={i}
              type="button"
              className={`drag-handle${selected === i ? ' active' : ''}`}
              aria-label={`Kéo để di chuyển lớp ${i + 1}`}
              style={{
                left: `${((area.left + l.x * area.width) / area.viewW) * 100}%`,
                top: `${((area.top + l.y * area.height) / area.viewH) * 100}%`,
                width: `${(w / area.viewW) * 100}%`,
                height: `${(h / area.viewH) * 100}%`,
                transform: `translate(-50%, -50%) rotate(${l.rotation}deg)`,
              }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                onSelect?.(i);
              }}
              onPointerMove={(e) => drag(i, e)}
              onKeyDown={(e) => nudge(i, l, e)}
              onFocus={() => onSelect?.(i)}
            >
              {selected === i && onRotate && (
                <span
                  className="rotate-knob"
                  title="Kéo để xoay"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    e.currentTarget.setPointerCapture(e.pointerId);
                  }}
                  onPointerMove={(e) => {
                    e.stopPropagation();
                    turn(i, e);
                  }}
                />
              )}
            </button>
          );
        })}
    </div>
  );
}
