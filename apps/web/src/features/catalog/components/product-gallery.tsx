'use client';

import type { ProductDetail } from '@nona/contracts';
import { useEffect, useState } from 'react';
import { useVariantChoice } from './variant-context';

export function ProductGallery({
  images,
  name,
}: {
  images: ProductDetail['images'];
  name: string;
}) {
  const [index, setIndex] = useState(0);
  const choice = useVariantChoice();
  const chosen = choice?.variantId;
  // Picking a colour shows that colour's own picture.
  useEffect(() => {
    const at = images.findIndex((i) => i.variantId && i.variantId === chosen);
    if (at >= 0) setIndex(at);
  }, [chosen, images]);
  const current = images[index];
  if (!current) {
    return (
      <div className="gallery">
        <div className="gallery-main" role="img" aria-label={`${name} (chưa có ảnh)`} />
      </div>
    );
  }
  return (
    <div className="gallery">
      <div className="gallery-main">
        <img
          src={current.url}
          alt={current.alt}
          width={current.width}
          height={current.height}
          fetchPriority="high"
        />
      </div>
      {images.length > 1 && (
        <div role="group" aria-label="Chọn ảnh" style={{ display: 'flex', gap: 8 }}>
          {images.map((img, i) => (
            <button
              key={img.url}
              type="button"
              aria-pressed={i === index}
              aria-label={`Xem ảnh ${i + 1}`}
              onClick={() => setIndex(i)}
              style={{
                width: 64,
                height: 64,
                padding: 0,
                border: i === index ? '2px solid var(--color-ink)' : '1px solid var(--color-line)',
                borderRadius: 12,
                overflow: 'hidden',
                background: 'none',
              }}
            >
              <img
                src={img.url}
                alt=""
                width={64}
                height={64}
                style={{ objectFit: 'cover', height: '100%' }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
