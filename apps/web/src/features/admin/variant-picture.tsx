'use client';

import { useRef } from 'react';

export const PICTURE_ACCEPT = '.svg,image/svg+xml,image/png,image/jpeg,image/webp';
export const PICTURE_HINT =
  'SVG, PNG, JPEG hoặc WebP, tối đa 8MB. Khách sẽ thiết kế trực tiếp trên ảnh này.';

/** Picture slot of a hat variant: shows the picture (or a placeholder) with real Chọn / Đổi / Gỡ buttons. */
export function PictureSlot({
  url,
  size = 96,
  busy = false,
  disabled = false,
  onPick,
  onRemove,
}: {
  url: string | null;
  size?: number;
  busy?: boolean;
  disabled?: boolean;
  onPick: (file: File) => void;
  onRemove?: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="picture-slot">
      <div className="picture-frame" style={{ width: size, height: size }}>
        {url ? <img src={url} alt="" width={size} height={size} /> : <span>Chưa có ảnh</span>}
      </div>
      {!disabled && (
        <div className="picture-actions">
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Đang tải…' : url ? 'Đổi ảnh' : 'Chọn ảnh'}
          </button>
          {url && onRemove && (
            <button
              type="button"
              className="btn btn-sm btn-danger-outline"
              disabled={busy}
              onClick={onRemove}
            >
              Gỡ ảnh
            </button>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept={PICTURE_ACCEPT}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
