# Frontend specification

## Application

Use Next.js App Router with TypeScript. The web application contains storefront, account, checkout, and protected admin route groups. Keep styling custom to NONA; utility CSS may support implementation but must not replace the brand with generic components.

Expected storefront routes:

```text
/, /shop, /san-pham/[slug], /gio-hang, /thanh-toan,
/don-hang/[code], /tai-khoan/*, /thiet-ke-non/*
```

Admin routes live under `/admin/*` with server-enforced authorization.

The storefront shell fills at least the viewport height (100dvh with a 100vh fallback). Main content grows to keep the footer at the viewport bottom on short pages; long pages scroll naturally with the footer after the content. The footer spans the page width, has a cream background and a visible 1px top border, and never overlays content. Header and footer retain their natural height.

## Rendering and state

- Server-render public category and product content for SEO and fast first load.
- Use client components only where interaction requires browser state.
- URL query parameters are the source of truth for shareable shop filters and sorting.
- Keep server state in a query/cache layer and local UI state near components. Do not duplicate checkout truth in global stores.
- Generate API client types from OpenAPI or shared public validation schemas.

## Commerce behavior

- Show price or stock changes returned during cart refresh and checkout quote.
- Disable duplicate submission, while still relying on backend idempotency.
- Payment return pages fetch authoritative state; never mark paid from query parameters.
- Preserve cart intent through authentication where safe.
- Distinguish unavailable, reserved, sold out, validation failure, and provider failure states.

## NONA design system

Define reusable tokens for color, typography, spacing, radius, shadow, motion, breakpoints, and focus rings. Maintain primitives for buttons, fields, cards, dialogs, drawers, toasts, price display, status badges, and empty/error/loading states.

Maintain the approved direction: warm cream surfaces, deep green text, red cultural accent, editorial serif headings, generous whitespace, and softly rounded but aligned cards. The shop shows four equal-height products per row on wide desktop, three on tablet, and two on mobile. Do not stagger commerce card heights.

Order details use a centered 1360px outer container with 32px desktop gutters, a wider product column, and a sidebar containing separate delivery and payment cards. Delivery fields have explicit labels; the payment card groups the payment method and monetary breakdown. Cancellation sits below the cards. Product thumbnails are 96px on desktop and 72px on phones. The page uses one column at widths up to 900px. The status timeline switches from horizontal to vertical at the same breakpoint for both COD and online payments. Custom-design summaries occupy a separate full-width row below their product; nested motif lists must not inherit the product-row grid. At phone widths, line totals sit below the product description so long names and design details wrap without horizontal overflow.

## Accessibility

Order details use the body sans-serif family (Be Vietnam Pro) consistently, including headings, the order code, and totals, rather than the editorial serif. Main headings use medium weight. Product, delivery, payment, confirmation, and custom-design blocks have visible 1px muted-green borders; shadows are not the only boundary between sections.

The account area (`/tai-khoan/*`, including My Designs) also uses Be Vietnam Pro throughout, with medium-weight page headings and profile names. The desktop navigation column is 280px wide to give profile details adequate space. Account navigation, panels, address cards, order cards, and design cards have visible 1px muted-green borders.

- Support keyboard operation and visible focus.
- Use semantic headings, labels, button names, dialog focus management, and meaningful image alternatives.
- Do not encode product state or validation only with color.
- Respect reduced motion and readable contrast.
- Target WCAG 2.2 AA for customer and admin critical paths.

## SEO and performance

- Unique metadata, canonical URLs, product structured data, sitemap, and robots policy.
- Responsive optimized images with explicit dimensions.
- Track Core Web Vitals and prevent grid/gallery layout shifts.
- Defer nonessential third-party scripts and make them consent-aware where required.

## Acceptance

Test desktop/mobile navigation, filter URL restoration, cart failures, checkout validation, authentication expiry, payment-return states, keyboard use, and empty/loading/error states. Critical purchase flows require end-to-end coverage.

## Admin panel (task.md revision)

- Every add/edit/delete control is a real button (`btn`, `btn-outline`, `btn-danger-outline`); the bare-link style `admin-link-button` is only used for sign-out and inline help links.
- The product create form creates the product, its variants (each with name, price, initial stock and an SVG/PNG/JPEG/WebP picture), then uploads pictures and posts the initial stock as inventory receipts. If a later step fails, the admin continues in the editor instead of creating a duplicate.
- The overview page (`/admin`) is a dashboard of SVG charts fed by `GET /v1/admin/dashboard`; staff without `orders:read` only see the catalogue counters.
- The "Nhật ký thao tác" and "Bảo mật" pages were removed from the menu. Audit entries are still written and readable through `GET /v1/admin/audit-logs`; MFA enrolment stays available at `/admin/security-setup`.
- Row actions of lists use a "⋯" menu (products: edit, view on shop, archive) and the status badge itself is a menu for quick status changes. Every admin list has an always-visible footer (range, page numbers, rows per page 10/20/50): server pages use `AdminPagination` (`pageSize` query), small client lists use `usePaged`.
- All `<select>` controls are the shared `Dropdown`, which always opens below its field. Every admin write shows a toast: errors always (red), success automatically unless a specific notice follows (`quiet` option for multi-step flows).
- Dashboard numbers use the body font (lining, tabular figures), not the display serif.

- **Storefront frame:** the site shell is fixed to the viewport (header and a slim footer stay put); only `<main id="main">` scrolls, and `ScrollReset` returns it to the top on navigation. The account menu has a fixed height. Primary "create" buttons in the admin carry `.admin-create` and stay fixed in the top-right corner. The designer canvas keeps a margin around the hat picture, largest underneath (`CANVAS_PAD`).
