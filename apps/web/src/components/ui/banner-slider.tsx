'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BannerImage } from '@/lib/banner';

const INTERVAL_MS = 5500;

/**
 * Photo banner: the pictures cross-fade with a slow zoom, advance by themselves, pause while the pointer or
 * keyboard focus is on them (and always stay still for people who asked for reduced motion), and can be
 * stepped with the arrows or the dots. Only the first picture is loaded eagerly. Each photo is shown whole
 * (`object-fit: contain`) over a blurred copy of itself, never cropped or stretched.
 */
export function BannerSlider({
  images,
  label = 'Ảnh Sắc Chằm',
}: {
  images: BannerImage[];
  label?: string;
}) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [still, setStill] = useState(false);
  const count = images.length;
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setStill(q.matches);
    sync();
    q.addEventListener('change', sync);
    return () => q.removeEventListener('change', sync);
  }, []);

  const go = useCallback((i: number) => setIndex(((i % count) + count) % count), [count]);

  useEffect(() => {
    if (paused || still || count < 2) return;
    timer.current = window.setTimeout(() => go(index + 1), INTERVAL_MS);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [index, paused, still, count, go]);

  if (count === 0) return null;
  return (
    <div
      className="banner"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      {images.map((img, i) => (
        <div
          key={img.src}
          className={`banner-slide${i === index ? ' on' : ''}${still ? ' still' : ''}`}
          aria-hidden={i !== index}
        >
          {/* the same photo, blurred, fills the space beside it so the whole picture can be shown uncropped */}
          <img className="banner-bg" src={img.src} alt="" aria-hidden="true" draggable={false} />
          <img
            className="banner-fg"
            src={img.src}
            alt={i === index ? img.alt : ''}
            loading={i === 0 ? 'eager' : 'lazy'}
            decoding="async"
            draggable={false}
          />
        </div>
      ))}
      {count > 1 && (
        <>
          <button
            type="button"
            className="banner-arrow prev"
            aria-label="Ảnh trước"
            onClick={() => go(index - 1)}
          >
            ‹
          </button>
          <button
            type="button"
            className="banner-arrow next"
            aria-label="Ảnh sau"
            onClick={() => go(index + 1)}
          >
            ›
          </button>
          <div className="banner-dots" role="tablist" aria-label="Chọn ảnh">
            {images.map((img, i) => (
              <button
                key={img.src}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Ảnh ${i + 1}`}
                onClick={() => go(i)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
