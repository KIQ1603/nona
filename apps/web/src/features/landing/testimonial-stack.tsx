'use client';

import type { LandingContent } from '@nona/contracts';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';

type Item = LandingContent['testimonials']['items'][number];
const POS = [
  'translate(0,0) rotate(0deg) scale(1)',
  'translate(13%,4%) rotate(6deg) scale(.95)',
  'translate(-13%,7%) rotate(-7deg) scale(.9)',
  'translate(2%,-4%) rotate(3deg) scale(.86)',
];

/** Photo card stack with a rotating quote. Click a card (or a dot) to flip to the next one. */
export function TestimonialStack({ items, active }: { items: Item[]; active: boolean }) {
  const n = items.length;
  const [top, setTop] = useState(0);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [fading, setFading] = useState(false);
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const next = useCallback(
    (to?: number) => {
      if (busy.current || n < 2) return;
      busy.current = true;
      setLeaving(top);
      setFading(true);
      timers.current.push(
        setTimeout(() => {
          setTop(to ?? (top + 1) % n);
          setLeaving(null);
          busy.current = false;
          setFading(false);
        }, 420),
      );
    },
    [n, top],
  );

  useEffect(() => {
    if (!active || n < 2) return;
    const id = setInterval(() => next(), 5600);
    return () => clearInterval(id);
  }, [active, n, next]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  if (n === 0) return null;
  const quote = items[top]!;
  const cardStyle = (i: number): CSSProperties => {
    if (leaving === i)
      return { transform: 'translate(130%,-12%) rotate(24deg) scale(1)', opacity: 0, zIndex: 11 };
    const p = (i - top + n) % n;
    return {
      transform: POS[Math.min(p, 3)],
      zIndex: 10 - p,
      opacity: p === 3 ? 0.75 : p > 3 ? 0 : 1,
    };
  };

  return (
    <>
      <div className="lp-testi-text">
        <div className="lp-qbox lp-qfade" style={{ opacity: fading ? 0 : 1 }}>
          <p className="lp-qtext">“{quote.quote}”</p>
          <div className="lp-qname">{quote.name}</div>
          <div className="lp-qwhere">{quote.where}</div>
        </div>
        {n > 1 && (
          <div className="lp-qdots">
            {items.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Xem đánh giá ${i + 1}`}
                style={{ width: i === top ? 30 : 8, opacity: i === top ? 1 : 0.35 }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (i !== top) next(i);
                }}
              />
            ))}
            <span className="lp-qhint">Chạm vào ảnh để xem tiếp</span>
          </div>
        )}
      </div>
      <div className="lp-testi-art">
        <div className="lp-stack" data-a="zoom" onClick={() => next()}>
          {items.map((t, i) => (
            <div className="lp-card" key={i} style={cardStyle(i)}>
              {t.imageUrl && (
                <img src={t.imageUrl} alt={t.caption} loading="lazy" draggable={false} />
              )}
              <div className="lp-cap">{t.caption}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
