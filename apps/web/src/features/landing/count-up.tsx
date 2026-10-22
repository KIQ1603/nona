'use client';

import { useEffect, useRef } from 'react';

/** Counts up from 0 whenever `play` changes (the slide became active). */
export function CountUp({ to, play }: { to: number; play: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || play === 0) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 1600);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(to * e).toLocaleString('vi-VN');
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, play]);
  return <span ref={ref}>{play === 0 ? '0' : to.toLocaleString('vi-VN')}</span>;
}
