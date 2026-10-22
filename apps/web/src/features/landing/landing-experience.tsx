'use client';

import type { ContactSettings, LandingContent, ProductDetail } from '@nona/contracts';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCart } from '@/features/cart/cart-store';
import { AccountAvatar } from '@/components/ui/account-avatar';
import { useCustomer } from '@/lib/customer-client';
import { CollectionSlide, type CollectionHandle } from './collection-slide';
import { CountUp } from './count-up';
import { hatSVG, STRAW_NATURAL } from './hat-svg';
import { LeaveLink as Link, LeaveProvider } from './leave';
import { OrderSlide } from './order-slide';
import { TestimonialStack } from './testimonial-stack';
import { useSlideEngine } from './use-slide-engine';

const SLIDES = [
  { title: 'Trang chủ', theme: 'light' },
  { title: 'Câu chuyện', theme: 'dark' },
  { title: 'Bộ sưu tập', theme: 'light' },
  { title: 'Quy trình', theme: 'dark' },
  { title: 'Khách hàng', theme: 'light' },
  { title: 'Đặt hàng', theme: 'dark' },
] as const;
const NAV = [1, 2, 3, 4, 5] as const;

const LOGO = hatSVG({ straw: STRAW_NATURAL, strap: '#b5442a', deco: 'plain' }, 'lg');
const HERO_HAT = hatSVG(
  { straw: ['#f6dd95', '#e6bf6e', '#b88a3a'], strap: '#b3202a', deco: 'band' },
  'hero',
);

const Title = ({ t }: { t: { before: string; accent: string; after: string } }) => (
  <>
    {t.before} {t.accent && <em>{t.accent}</em>} {t.after}
  </>
);

export function LandingExperience({
  content,
  products,
  contact,
  freeShippingThresholdVnd,
}: {
  content: LandingContent;
  products: ProductDetail[];
  contact: ContactSettings;
  freeShippingThresholdVnd: number | null;
}) {
  const stageRef = useRef<HTMLElement>(null);
  const collection = useRef<CollectionHandle>(null);
  const heroHat = useRef<HTMLDivElement>(null);
  const { cart } = useCart();
  const { user } = useCustomer();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const leave = useCallback(
    (href: string) => {
      if (leaving) return;
      setLeaving(true);
      setTimeout(() => router.push(href), 480);
    },
    [leaving, router],
  );
  const [countPlay, setCountPlay] = useState(0);
  const [leaves, setLeaves] = useState<
    { left: number; dur: number; delay: number; scale: number }[]
  >([]);
  const [hint, setHint] = useState('Cuộn · Kéo · Phím mũi tên');

  const { index, go } = useSlideEngine(stageRef, {
    hSlide: 2,
    onHSwipe: (dir) => collection.current?.step(dir),
    onEnter: (i) => {
      if (i === 1) setTimeout(() => setCountPlay((n) => n + 1), 900);
    },
  });

  useEffect(() => {
    setLeaves(
      Array.from({ length: 9 }, () => ({
        left: Math.random() * 100,
        dur: 9 + Math.random() * 10,
        delay: -Math.random() * 16,
        scale: 0.55 + Math.random() * 0.6,
      })),
    );
    if (matchMedia('(pointer:coarse)').matches) setHint('Vuốt lên để khám phá');
  }, []);

  // hero hat parallax follows the pointer
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const el = heroHat.current;
      if (!el || index !== 0) return;
      el.style.setProperty('--mx', String((e.clientX / innerWidth - 0.5) * 2));
      el.style.setProperty('--my', String((e.clientY / innerHeight - 0.5) * 2));
    };
    window.addEventListener('mousemove', move);
    return () => window.removeEventListener('mousemove', move);
  }, [index]);

  // coming back with the browser's back button must not leave the curtain down
  useEffect(() => {
    const reset = () => setLeaving(false);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  const theme = SLIDES[index]?.theme ?? 'light';
  const { hero, story, process, testimonials, order } = content;
  const sealText = useMemo(() => (story.badgeText ? `${story.badgeText} ` : ''), [story.badgeText]);

  return (
    <LeaveProvider value={leave}>
      <div className={`lp${leaving ? ' lp-leaving' : ''}`} data-theme={theme}>
        <div className="lp-curtain" aria-hidden="true" />
        <header className="lp-hdr">
          <button type="button" className="lp-logo" onClick={() => go(0)} aria-label="Trang chủ">
            <span className="lp-logo-hat" dangerouslySetInnerHTML={{ __html: LOGO }} />
            <span className="lp-fd lp-logo-text">
              NO<em>NA</em>
            </span>
          </button>
          <nav className="lp-topnav" aria-label="Các phần của trang">
            {NAV.map((i) => (
              <button
                key={i}
                type="button"
                className={`lp-navlink${index === i ? ' on' : ''}`}
                onClick={() => go(i)}
              >
                {SLIDES[i]!.title}
              </button>
            ))}
            <Link className="lp-navlink" href="/shop">
              Cửa hàng
            </Link>
            <Link className="lp-navlink" href="/bai-viet">
              Bài viết
            </Link>
            <Link className="lp-navlink" href="/lien-he">
              Liên hệ
            </Link>
          </nav>
          <div className="lp-hdr-right">
            <Link
              className="lp-iconbtn"
              href="/tai-khoan"
              prefetch={false}
              aria-label={user ? `Tài khoản của ${user.fullName}` : 'Đăng nhập'}
            >
              <AccountAvatar user={user} />
            </Link>
            <button
              type="button"
              className="lp-iconbtn"
              aria-label="Giỏ hàng"
              onClick={() => go(5)}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 8h14l-1 12H6L5 8z" />
                <path d="M9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              {cart.itemCount > 0 && <span className="lp-badge">{cart.itemCount}</span>}
            </button>
          </div>
        </header>

        <div className="lp-dots" role="tablist" aria-label="Chuyển phần">
          {SLIDES.map((s, i) => (
            <button
              key={s.title}
              type="button"
              className={`lp-dot${index === i ? ' on' : ''}`}
              aria-label={s.title}
              aria-selected={index === i}
              onClick={() => go(i)}
            >
              <span>{s.title}</span>
            </button>
          ))}
        </div>

        <div className="lp-counter">
          <span className="now">{String(index + 1).padStart(2, '0')}</span>
          <span className="lp-cbar">
            <i style={{ transform: `scaleX(${(index + 1) / SLIDES.length})` }} />
          </span>
          <span className="total">{String(SLIDES.length).padStart(2, '0')}</span>
          <span className="title">{SLIDES[index]?.title}</span>
        </div>

        <div className="lp-navbtns">
          <button type="button" className="lp-nb" aria-label="Lên" onClick={() => go(index - 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 15l6-6 6 6" />
            </svg>
          </button>
          <button type="button" className="lp-nb" aria-label="Xuống" onClick={() => go(index + 1)}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
        </div>

        <main className="lp-stage" ref={stageRef}>
          {/* 0 HERO */}
          <section className="lp-slide lp-slide-hero" data-theme="light" aria-label="Trang chủ">
            <div className="lp-leaves" aria-hidden="true">
              {leaves.map((l, i) => (
                <span
                  key={i}
                  className="lp-leaf"
                  style={{
                    left: `${l.left}%`,
                    animationDuration: `${l.dur}s`,
                    animationDelay: `${l.delay}s`,
                    transform: `scale(${l.scale})`,
                  }}
                />
              ))}
            </div>
            <svg
              className="lp-hills"
              viewBox="0 0 1440 300"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <path d="M0 140C200 60 400 180 700 110S1200 40 1440 120V300H0Z" fill="#b9d08c" />
              <path
                d="M0 190C250 120 500 230 800 170S1250 120 1440 190V300H0Z"
                fill="#82a95c"
                style={{ transitionDelay: '.15s' }}
              />
              <path
                d="M0 240C300 190 600 280 900 230S1300 200 1440 240V300H0Z"
                fill="#3f6b3a"
                style={{ transitionDelay: '.3s' }}
              />
            </svg>
            <div className="lp-inner">
              <div className="lp-wrap lp-grid cols-2">
                <div className="lp-hero-text">
                  {hero.eyebrow && (
                    <div className="lp-eyebrow" data-a>
                      {hero.eyebrow}
                    </div>
                  )}
                  <h1 className="lp-fd lp-h1" data-a>
                    <span>{hero.titleTop}</span>
                    <em>{hero.titleAccent}</em>
                  </h1>
                  {hero.text && (
                    <p className="lp-lead" data-a>
                      {hero.text}
                    </p>
                  )}
                  <div className="lp-actions" data-a>
                    <button type="button" className="lp-btn lp-btn-p" onClick={() => go(2)}>
                      {hero.primaryCta}
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        aria-hidden="true"
                      >
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </button>
                    <button type="button" className="lp-btn lp-btn-g" onClick={() => go(1)}>
                      {hero.secondaryCta}
                    </button>
                  </div>
                </div>
                <div className="lp-hero-art">
                  <div className="lp-hh" data-a="zoom">
                    <div className="lp-sun-rays" />
                    <div className="lp-sun-core" />
                    <div className="lp-hero-hat" ref={heroHat}>
                      <div className="lp-float" dangerouslySetInnerHTML={{ __html: HERO_HAT }} />
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="lp-scrollhint" data-a="fade">
              <div className="lp-mouse" />
              <span>{hint}</span>
            </div>
          </section>

          {/* 1 STORY */}
          <section className="lp-slide lp-slide-story" data-theme="dark" aria-label={story.eyebrow}>
            {story.bigWord && (
              <div className="lp-bgword" style={{ color: 'rgba(246,236,214,.03)' }}>
                {story.bigWord}
              </div>
            )}
            <div className="lp-inner">
              <div className="lp-wrap lp-grid md-cols-2">
                <div className="lp-story-art" data-a="zoom">
                  <div style={{ filter: 'drop-shadow(0 30px 40px rgba(0,0,0,.5))' }}>
                    <div className="lp-hatmask">
                      {story.imageUrl && (
                        <img
                          className="lp-kb"
                          src={story.imageUrl}
                          alt={story.imageAlt}
                          draggable={false}
                        />
                      )}
                    </div>
                  </div>
                  {sealText && (
                    <svg className="lp-seal" viewBox="0 0 200 200" aria-hidden="true">
                      <defs>
                        <path
                          id="lp-circ"
                          d="M100,100 m-78,0 a78,78 0 1,1 156,0 a78,78 0 1,1 -156,0"
                        />
                      </defs>
                      <circle cx="100" cy="100" r="98" fill="#b5442a" />
                      <text fontSize="15" fontWeight="600" letterSpacing="2" fill="#f6ecd6">
                        <textPath href="#lp-circ" textLength="480" lengthAdjust="spacing">
                          {sealText}
                        </textPath>
                      </text>
                      <text x="100" y="116" textAnchor="middle" fontSize="46" fill="#f6ecd6">
                        ⛰
                      </text>
                    </svg>
                  )}
                </div>
                <div className="lp-story-text">
                  <div className="lp-eyebrow" data-a>
                    {story.eyebrow}
                  </div>
                  <h2 className="lp-fd lp-h2" data-a>
                    <Title t={story.title} />
                  </h2>
                  {story.text && (
                    <p className="lp-lead" data-a>
                      {story.text}
                    </p>
                  )}
                  {story.stats.length > 0 && (
                    <div className="lp-stats" data-a>
                      {story.stats.map((s) => (
                        <div className="lp-stat" key={s.label}>
                          <div className="num">
                            <CountUp to={s.value} play={countPlay} />
                            {s.suffix}
                          </div>
                          <div className="label">{s.label}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* 2 COLLECTION */}
          <section
            className="lp-slide lp-slide-collection"
            data-theme="light"
            aria-label="Bộ sưu tập"
          >
            <div className="lp-bgword" style={{ fontSize: '44vw', color: 'rgba(31,61,43,.055)' }}>
              NÓN
            </div>
            <div className="lp-inner">
              <CollectionSlide ref={collection} products={products} />
            </div>
          </section>

          {/* 3 PROCESS */}
          <section className="lp-slide lp-slide-process" data-theme="dark" aria-label="Quy trình">
            <div className="lp-inner">
              <div className="lp-wrap">
                <div className="lp-eyebrow" data-a>
                  {process.eyebrow}
                </div>
                <h2 className="lp-fd lp-h2" data-a>
                  <Title t={process.title} />
                </h2>
                <div className="lp-line lp-pline" />
                <div className="lp-steps">
                  {process.steps.map((s, i) => (
                    <div key={s.title} data-a style={{ ['--d' as string]: 300 + i * 130 }}>
                      <div className="lp-pc">
                        <div className="lp-pnum">0{i + 1}</div>
                        <div>
                          <div className="icon">{s.icon}</div>
                          <h3>{s.title}</h3>
                          <p>{s.text}</p>
                          {s.duration && <span className="dur">⏱ {s.duration}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* 4 TESTIMONIALS */}
          <section
            className="lp-slide lp-slide-testimonials"
            data-theme="light"
            aria-label="Khách hàng"
          >
            <div className="lp-bgword" style={{ fontSize: '36vw', color: 'rgba(181,68,42,.06)' }}>
              “
            </div>
            <div className="lp-inner">
              <div className="lp-wrap lp-grid md-cols-2">
                <TestimonialStack items={testimonials.items} active={index === 4} />
              </div>
            </div>
          </section>

          {/* 5 ORDER */}
          <section className="lp-slide lp-slide-order" data-theme="dark" aria-label="Đặt hàng">
            <OrderSlide
              content={order}
              contact={contact}
              freeShippingThresholdVnd={freeShippingThresholdVnd}
              onPickProducts={() => go(2)}
            />
          </section>
        </main>
      </div>
    </LeaveProvider>
  );
}
