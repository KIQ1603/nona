'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

interface Options {
  /** Called after a slide change (not on first render). */
  onEnter?: (index: number) => void;
  /** Horizontal swipe / arrow keys on `hSlide` (the collection carousel). */
  onHSwipe?: (dir: 1 | -1) => void;
  hSlide?: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Full-screen slide engine of the brand landing: wheel, keyboard, touch and mouse drag with a parallax
 * "card stack" transition. It drives the slide elements' styles directly (needed for 60fps dragging) and
 * reports the current index to React for the chrome (dots, counter, theme).
 */
export function useSlideEngine(stageRef: RefObject<HTMLElement | null>, options: Options = {}) {
  const [index, setIndex] = useState(0);
  const goRef = useRef<(n: number) => void>(() => undefined);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const slides = [...stage.querySelectorAll<HTMLElement>('.lp-slide')];
    const N = slides.length;
    if (N === 0) return;
    const state = { i: 0, busy: false };
    let suppress = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    document.documentElement.classList.add('lp-lock');

    const inner = (i: number) => slides[i]!.querySelector<HTMLElement>('.lp-inner')!;

    // default reveal delays: staggered in document order
    slides.forEach((s) =>
      s.querySelectorAll<HTMLElement>('[data-a]').forEach((el, i) => {
        if (!el.style.getPropertyValue('--d')) el.style.setProperty('--d', String(i * 110));
      }),
    );

    let renderTimer: ReturnType<typeof setTimeout> | undefined;
    function render(prev: number | null) {
      const c = state.i;
      const first = prev == null;
      slides.forEach((s, i) => {
        const involved = !first && (i === c || i === prev || (prev === c && Math.abs(i - c) <= 1));
        s.classList.remove('drag');
        s.style.transition = involved ? '' : 'none';
        s.style.visibility = i === c || involved ? 'visible' : 'hidden';
        s.style.transform = `translate3d(0,${i < c ? '-20%' : i > c ? '100%' : '0'},0)`;
        s.style.setProperty('--shade', String(i < c ? 0.6 : 0));
        const t = (s as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t;
        if (i === c) {
          if (t) clearTimeout(t);
          if (first) timers.push(setTimeout(() => s.classList.add('active'), 150));
          else s.classList.add('active');
        } else if (s.classList.contains('active')) {
          if (t) clearTimeout(t);
          (s as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t = setTimeout(
            () => s.classList.remove('active'),
            1050,
          );
        }
      });
      setIndex(c);
      if (renderTimer) clearTimeout(renderTimer);
      renderTimer = setTimeout(
        () =>
          slides.forEach((s, i) => {
            if (i !== state.i) s.style.visibility = 'hidden';
          }),
        1000,
      );
      if (prev !== c && prev != null) optionsRef.current.onEnter?.(c);
    }

    function go(n: number) {
      n = clamp(n, 0, N - 1);
      if (n === state.i || state.busy) return;
      const prev = state.i;
      state.i = n;
      state.busy = true;
      render(prev);
      timers.push(setTimeout(() => (state.busy = false), 900));
    }
    goRef.current = go;

    const edgeOK = (dir: number) => {
      const s = inner(state.i);
      // A slide that never scrolls (overflow hidden) is always at its edge, whatever decorative overflow it has.
      if (getComputedStyle(s).overflowY === 'hidden') return true;
      return dir > 0 ? s.scrollTop + s.clientHeight >= s.scrollHeight - 3 : s.scrollTop <= 2;
    };
    function setSlide(i: number, y: number, shade: number) {
      const s = slides[i]!;
      s.style.visibility = 'visible';
      s.style.transform = `translate3d(0,${y}px,0)`;
      s.style.setProperty('--shade', String(shade));
    }
    function drag(dy: number) {
      const H = innerHeight,
        c = state.i,
        p = Math.min(1, Math.abs(dy) / H);
      slides.forEach((s) => {
        s.style.transition = 'none';
        s.classList.add('drag');
      });
      if (dy < 0 && c < N - 1) {
        setSlide(c, dy * 0.2, p * 0.6);
        setSlide(c + 1, H + dy, 0);
      } else if (dy > 0 && c > 0) {
        setSlide(c, dy, 0);
        setSlide(c - 1, -0.2 * H + dy * 0.2, 0.6 * (1 - p));
      } else setSlide(c, dy * 0.2, 0);
    }

    let lastT = 0,
      lastD = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      let d = e.deltaY;
      if (e.deltaMode === 1) d *= 16;
      if (Math.abs(d) < 2 && Math.abs(e.deltaX) > 2) return;
      const dir = d > 0 ? 1 : -1,
        now = performance.now(),
        abs = Math.abs(d);
      if (!edgeOK(dir)) {
        inner(state.i).scrollTop += d;
        lastT = now;
        lastD = abs;
        return;
      }
      const streaming = now - lastT < 110 && abs <= lastD + 2;
      lastT = now;
      lastD = abs;
      if (state.busy || streaming || abs < 6) return;
      go(state.i + dir);
    };

    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element).closest?.('input,select,textarea')) return;
      const h = optionsRef.current;
      if (['ArrowDown', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) {
        e.preventDefault();
        go(state.i + 1);
      } else if (['ArrowUp', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) {
        e.preventDefault();
        go(state.i - 1);
      } else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(N - 1);
      else if (state.i === h.hSlide && e.key === 'ArrowRight') h.onHSwipe?.(1);
      else if (state.i === h.hSlide && e.key === 'ArrowLeft') h.onHSwipe?.(-1);
    };

    type G = {
      on: boolean;
      mode?: 'v' | 'h' | 'scroll' | 'none' | null;
      x: number;
      y: number;
      t: number;
      type: 'touch' | 'mouse';
      dx: number;
      dy: number;
      moved: boolean;
    };
    let g: G = { on: false, x: 0, y: 0, t: 0, type: 'mouse', dx: 0, dy: 0, moved: false };
    const gStart = (x: number, y: number, type: 'touch' | 'mouse') => {
      g = { on: true, mode: null, x, y, t: performance.now(), type, dx: 0, dy: 0, moved: false };
    };
    const gMove = (x: number, y: number, e: Event) => {
      if (!g.on) return;
      const dx = x - g.x,
        dy = y - g.y;
      g.dx = dx;
      g.dy = dy;
      if (!g.mode) {
        if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
        if (Math.abs(dx) > Math.abs(dy) * 1.2) g.mode = 'h';
        else if (state.busy) g.mode = 'none';
        else {
          const dir = dy < 0 ? 1 : -1;
          g.mode = edgeOK(dir) ? 'v' : g.type === 'touch' ? 'scroll' : 'none';
        }
      }
      if (g.mode === 'v') {
        if (e.cancelable) e.preventDefault();
        drag(dy);
        g.moved = true;
      } else if (g.mode === 'h') {
        if (e.cancelable && g.type === 'touch') e.preventDefault();
        g.moved = true;
      }
    };
    const gEnd = () => {
      if (!g.on) return;
      g.on = false;
      const { mode, dx, dy } = g;
      const dt = Math.max(1, performance.now() - g.t);
      if (g.moved && g.type === 'mouse') {
        suppress = true;
        timers.push(setTimeout(() => (suppress = false), 0));
      }
      if (mode === 'v') {
        const dir = dy < 0 ? 1 : -1,
          v = Math.abs(dy) / dt,
          t = state.i + dir;
        const ok = Math.abs(dy) > innerHeight * 0.14 || (v > 0.4 && Math.abs(dy) > 30);
        if (ok && t >= 0 && t < N) go(t);
        else render(state.i);
      } else if (mode === 'h' && state.i === optionsRef.current.hSlide && Math.abs(dx) > 40) {
        optionsRef.current.onHSwipe?.(dx < 0 ? 1 : -1);
      }
    };
    const isField = (t: EventTarget | null) =>
      (t as Element | null)?.closest?.('input,select,textarea');
    const onTouchStart = (e: TouchEvent) => {
      if (isField(e.target)) {
        g.on = false;
        return;
      }
      const t = e.touches[0]!;
      gStart(t.clientX, t.clientY, 'touch');
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0]!;
      gMove(t.clientX, t.clientY, e);
    };
    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0 || isField(e.target)) return;
      gStart(e.clientX, e.clientY, 'mouse');
    };
    const onMouseMove = (e: MouseEvent) => gMove(e.clientX, e.clientY, e);
    const onClickCapture = (e: MouseEvent) => {
      if (suppress) {
        e.stopPropagation();
        e.preventDefault();
        suppress = false;
      }
    };
    const onDragStart = (e: Event) => e.preventDefault();
    const onResize = () => render(state.i);

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKey);
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', gEnd);
    window.addEventListener('touchcancel', gEnd);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', gEnd);
    window.addEventListener('click', onClickCapture, true);
    window.addEventListener('dragstart', onDragStart);
    window.addEventListener('resize', onResize);
    render(null);

    return () => {
      document.documentElement.classList.remove('lp-lock');
      timers.forEach(clearTimeout);
      if (renderTimer) clearTimeout(renderTimer);
      slides.forEach((s) => {
        const t = (s as HTMLElement & { _t?: ReturnType<typeof setTimeout> })._t;
        if (t) clearTimeout(t);
      });
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', gEnd);
      window.removeEventListener('touchcancel', gEnd);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', gEnd);
      window.removeEventListener('click', onClickCapture, true);
      window.removeEventListener('dragstart', onDragStart);
      window.removeEventListener('resize', onResize);
    };
  }, [stageRef]);

  return { index, go: (n: number) => goRef.current(n) };
}
