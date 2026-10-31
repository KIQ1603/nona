'use client';

import { formatVnd } from '@nona/contracts';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface PickerOption {
  id: string;
  name: string;
  priceVnd?: number;
  preview: ReactNode;
}

/** Drop-down that opens a grid of choices (preview, name, price). The options come from admin settings. */
export function GridPicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="grid-picker" ref={root}>
      <button
        type="button"
        className="grid-picker-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        onClick={() => setOpen(!open)}
      >
        <span className="gp-preview">{current?.preview}</span>
        <span className="gp-name">{current?.name ?? 'Chọn…'}</span>
        {current?.priceVnd ? (
          <span className="gp-price">+{formatVnd(current.priceVnd)}</span>
        ) : null}
        <span className="gp-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul className="grid-picker-panel" id={listId} role="listbox" aria-label={label}>
          {options.map((o) => (
            <li key={o.id} role="presentation">
              <button
                type="button"
                role="option"
                aria-selected={o.id === value}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
              >
                <span className="gp-preview">{o.preview}</span>
                <span className="gp-name">{o.name}</span>
                <span className="gp-price">
                  {o.priceVnd ? `+${formatVnd(o.priceVnd)}` : 'Miễn phí'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const Swatch = ({ hex }: { hex: string }) => (
  <i className="gp-swatch" style={{ background: hex }} aria-hidden="true" />
);
/** A charm's thumbnail: its uploaded picture, or its vector shape. */
export const MotifThumb = ({
  motif,
  src,
  color = null,
}: {
  motif: { path: string | null; imageKey: string | null; tint?: 'flat' | 'shaded' | 'none' };
  src: (imageKey: string) => string;
  /** Palette colour to show the sticker in (null = its own colours / the default ink). */
  color?: string | null;
}) => {
  if (motif.imageKey) {
    const url = src(motif.imageKey);
    if (color && motif.tint !== 'none')
      // flat: a silhouette filled with the colour; shaded: the colour multiplied into the picture so its light stays
      return (
        <span
          className="motif-tint"
          aria-hidden="true"
          style={{
            backgroundColor: color,
            ...(motif.tint === 'shaded'
              ? {
                  backgroundImage: `url(${url})`,
                  backgroundSize: 'contain',
                  backgroundPosition: 'center',
                  backgroundRepeat: 'no-repeat',
                  backgroundBlendMode: 'multiply',
                }
              : {}),
            WebkitMask: `url(${url}) center / contain no-repeat`,
            mask: `url(${url}) center / contain no-repeat`,
          }}
        />
      );
    return <img src={url} alt="" width="100%" height="100%" draggable={false} />;
  }
  return motif.path ? (
    <MotifShape path={motif.path} color={motif.tint === 'none' ? null : color} />
  ) : null;
};

export const MotifShape = ({ path, color = null }: { path: string; color?: string | null }) => (
  <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
    <path
      d={path}
      fill={color ?? '#242a27'}
      stroke={color ? 'rgba(60,30,30,.35)' : 'none'}
      strokeWidth="3"
      strokeLinejoin="round"
    />
  </svg>
);
