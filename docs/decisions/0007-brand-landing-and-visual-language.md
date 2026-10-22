# 0007 — Brand landing and visual language

**Status:** accepted

## Context

`prototype/landing-UI.html` defines the brand's look: warm cream/straw/green/terracotta palette, Playfair Display headings with Be Vietnam Pro body text, pill buttons that lift on hover, line-led eyebrows, paper grain, and a full-screen sequence of six slides with drag/wheel/keyboard navigation.

## Decision

- **Tokens, not copies.** The palette and fonts live in `styles/tokens.css` (`--color-*`, `--font-display` = Playfair). All pages inherit them; there is no second theme. A global paper grain, eyebrow style and button lift are in `base.css`; the header uses the hat logo and a translucent cream bar, the footer uses the dark-green slide treatment.
- **Landing at `/`** is a client "slide engine" (`features/landing/use-slide-engine.ts`, a faithful port of the prototype's wheel/touch/keyboard/parallax behaviour) rendering six sections in its own route group `(landing)` with its own header, so the global site chrome does not wrap it. Styles are namespaced `.lp-*` (the prototype's Tailwind utilities were translated to plain CSS; no new framework).
- **Real data, not demo data.** The collection slide shows real featured products (images, variants, prices, stock) and uses the real cart and checkout; the last slide shows the backend cart totals and hands off to `/thanh-toan`. Address, hours and channels come from the contact settings; the free-shipping sentence from the shipping settings.
- **Admin-managed copy.** Hero, story (text, numbers, picture), process steps and testimonials are `site_settings.landing` (`GET /v1/storefront/landing`, `PATCH /v1/admin/settings/landing`). Image links must be `https://`. The seeded copy, numbers ("Từ 1950", "70+ năm", "12.000+ khách"), photos and testimonials are SAMPLE content from the prototype and must be replaced by the owner with facts they can stand behind.
- The illustrated hat (`hat-svg.ts`) is decorative (logo, hero, fallback art); product pictures remain the uploaded images.

## Consequences

- Landing content changes need no deploy.
- The landing depends on JavaScript for its transitions; the server-rendered markup still contains all copy for crawlers.
- Photos are hot-linked from the URLs the admin enters; the shop should host rights-cleared images (the sample Pexels links are for development only).
