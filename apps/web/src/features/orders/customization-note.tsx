'use client';

import { formatVnd, type OrderCustomization } from '@nona/contracts';
import { useEffect, useRef, useState } from 'react';

/** Read-only summary of the design snapshot stored on an order line (what the workshop must make). */
export function CustomizationNote({ c, staff }: { c: OrderCustomization; staff?: boolean }) {
  const [broken, setBroken] = useState(false);
  const img = useRef<HTMLImageElement>(null);
  // The preview is private (owner browser or staff). Try it everywhere and hide it quietly when it is refused;
  // the error may fire before hydration, so also check the already-failed image.
  useEffect(() => {
    if (img.current?.complete && img.current.naturalWidth === 0) setBroken(true);
  }, []);
  const showPreview = !broken;
  return (
    <div className="customization-note">
      {showPreview && (
        <img
          ref={img}
          src={`/api/custom-designs/versions/${c.versionId}/preview`}
          alt=""
          width={64}
          height={80}
          loading="lazy"
          onError={() => setBroken(true)}
        />
      )}
      <div>
        <strong>
          Thiết kế riêng
          {staff ? ` (v${c.versionNo})` : ''}
        </strong>
        <small>
          {c.variantName ? `Màu/mẫu: ${c.variantName}` : 'Nón tùy chỉnh'}
          {c.priceAdditionVnd > 0 && ` · phụ thu ${formatVnd(c.priceAdditionVnd)}`}
        </small>
        {staff && (
          <a href={`/admin/designs/${c.designId}`} className="admin-link-button">
            Xem / duyệt thiết kế →
          </a>
        )}
        {c.layers.length > 0 && (
          <ul>
            {c.layers.map((l, i) => (
              <li key={i}>{l.summary}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
