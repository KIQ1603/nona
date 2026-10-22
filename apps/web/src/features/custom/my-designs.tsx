'use client';

import { DESIGN_STATUS_LABELS, designListSchema, type DesignStatus } from '@nona/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCustomer } from '@/lib/customer-client';

type Item = ReturnType<typeof designListSchema.parse>['items'][number];

/** The shopper's own designs (account, or this browser's guest designs). */
export function MyDesigns({ heading }: { heading?: string }) {
  const { request, status, user } = useCustomer();
  const [items, setItems] = useState<Item[] | null>(null);
  useEffect(() => {
    if (status === 'loading') return;
    let live = true;
    request<unknown>('GET', '/custom-designs')
      .then((raw) => live && setItems(designListSchema.parse(raw).items))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [request, status, user?.id]);

  if (items === null) return <p className="lead">Đang tải…</p>;
  if (items.length === 0) return heading ? null : <p className="lead">Bạn chưa có thiết kế nào.</p>;
  return (
    <section className="my-designs">
      {heading && <h2>{heading}</h2>}
      <ul className="design-cards">
        {items.map((d) => (
          <li key={d.id}>
            <Link href={`/thiet-ke-non/${d.id}`}>
              {d.hasPreview ? (
                <img
                  src={`/api/custom-designs/versions/${d.versionId}/preview`}
                  alt=""
                  width={160}
                  height={200}
                  loading="lazy"
                />
              ) : (
                <div className="design-noimg">Bản nháp</div>
              )}
              <strong>{d.title}</strong>
              <small>
                {d.productName} · v{d.versionNo}
              </small>
              <span className={`pill pill-d-${d.status.toLowerCase()}`}>
                {DESIGN_STATUS_LABELS[d.status as DesignStatus]}
              </span>
              {d.canOrder && <small>Sẵn sàng đặt hàng</small>}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
