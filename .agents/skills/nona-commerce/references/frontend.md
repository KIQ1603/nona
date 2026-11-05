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

## Sắc Chằm design system

Define reusable tokens for color, typography, spacing, radius, shadow, motion, breakpoints, and focus rings. Maintain primitives for buttons, fields, cards, dialogs, drawers, toasts, price display, status badges, and empty/error/loading states. The public storefront uses the supplied circular Sắc Chằm mark; internal package names and backend identifiers remain NONA for compatibility.

Maintain the approved direction from the UI brief: warm cream surfaces, burgundy text and primary actions, peach cultural accents, editorial serif headings, generous whitespace, fine burgundy borders, and restrained rectangular cards. The shop shows four equal-height products per row on wide desktop, three on tablet, and two on mobile. Do not stagger commerce card heights.

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

- **Storefront information architecture:** `/` is the public Giới thiệu landing. `/trang-chu` is the Home page: public (guests see it too; a signed-in customer is also greeted by name) and it is the default destination after sign-in. The public header orders Trang chủ, Giới thiệu, Sản phẩm, Tự thiết kế, Bài viết and Liên hệ. The site shell uses a sticky natural-height header, scrolling document content, and a full contact footer after the page content. `ScrollReset` returns the document to the top on navigation. The account menu has a fixed height. Primary "create" buttons in the admin carry `.admin-create` and stay fixed in the top-right corner. The designer canvas keeps a margin around the hat picture, largest underneath (`CANVAS_PAD`).
- **Signed-in home (`/trang-chu`), after the UI demo:** a full-width photo hero (`/brand/home-hero.jpg`, right side, dark burgundy-brown fade on the left) with the slogan "Sắc Chằm / Gìn giữ nét Việt thêu sắc hôm nay" and a "Khám phá ngay" button, a row of four line-icon values, a "Sản phẩm nổi bật" row of three category cards with arrows (Nón lá, Móc khóa, Kẹp tóc; images `/brand/home-nonla.jpg`, `home-mockhoa.jpg`, `home-keptoc.jpg`, all linking to `/shop` until those categories exist in the catalogue), then "Dành cho bạn" with real featured products. The four brand images are low-resolution crops of the UI demo and are placeholders: replace the files (same names) with real photos. Styles: `styles/home-sc.css`.
- **Shop page `/shop` ("Nón lá"), after the Figma wireframe:** "Sản phẩm nổi bật" (three featured products with a name pill), the title "Nón lá", then one collapsible `<details>` group per catalogue category with a three-column grid (two on tablet, one on phones). Each card: rounded photo, name, short summary, price with the struck compare-at price, and "Thêm vào giỏ" (quick add; multi-variant products link to the detail page) plus "Chi tiết". `?category=` shows one group and `?q=` searches inside the groups; the price/colour/style filters, sort bar and pagination of the earlier shop were removed (each group loads up to 48 products). Styles: `styles/nonla-sc.css`.
- **Product type pages `/shop/<type>`** replace the single shop page: `/shop` redirects to the first type (or shows a flat result grid with `?q=` / `?category=`). The header, mobile menu and landing nav list the types after "Giới thiệu". The earlier note on `/shop` ("Nón lá" with groups) now applies to every type; unknown types return 404; a type without products shows "Sắp ra mắt".
- **Designer `/thiet-ke-non`, after the Figma wireframe:** title "Tự thiết kế sản phẩm"; left "Chọn sản phẩm" (one tile per product type, types without a designable product disabled); centre the live preview with thumbnails of the products of that type; right "Tùy chỉnh thiết kế" with tabs "Họa tiết" (charm grid of six with "Xem thêm") and "Màu sắc" (the product's variants); below, the pink "Lưu ý" box (admin text `options.note`) and the "Thêm vào giỏ hàng" / "Đặt hàng ngay" buttons; then "Sản phẩm nổi bật". Styles: `styles/design-sc.css`. Pricing, validation and ordering are unchanged (backend authoritative).
- Admin: category form has "Thuộc loại" (type or group); the product form has "Nổi bật" and a category list as "Nón lá › Nón họa"; the custom-options page has the "Lưu ý" text.
- **Designer tabs:** "Họa tiết" (sticker grid shown in the chosen colour), "Chữ" (type a word: each letter becomes its own draggable sticker; font and colour chosen first) and "Màu sắc" (the five palette colours: they recolour the selected sticker/letter and are the colour of the next ones; below them the product's own variants). The layer list names each layer with its colour. Drag handles of letters are sized from `letterHeightCm`. Admin: palette, letter height, letters per entry and layer limit are edited on the custom-options page; each sticker has "Khách được đổi màu sticker này".
- **Home `/trang-chu` (public), after the brief:** (1) header with the "Sản phẩm" dropdown (product types with their groups, from the admin; groups link to `/shop/<type>#<group>`; hover/focus/tap, Escape closes); (2) hero "Chằm nét xưa, gài duyên nay" with "Khám phá sản phẩm" and "Tự thiết kế ngay"; (3) one large card per product type (name, the type's description, "Xem sản phẩm"); (4) up to 8 featured products ("Xem chi tiết" / "Thêm vào giỏ hàng"; first products if none is flagged); (5) short story with "Khám phá câu chuyện của chúng mình" (to `/`); (6) designer banner with the same product before and after stickers, drawn by the designer's own renderer (hidden while the designer is off), CTA "Tạo dấu ấn của riêng bạn"; (7) the contact footer of the shell.
- **Photo banner (Trang chủ and Giới thiệu):** both heroes are a split: the copy on a solid colour block (dark brown for Trang chủ, beige for Giới thiệu) and `BannerSlider` on the right. Trang chủ shows photo 6 (`/public/banner/banner-6.jpg`), Giới thiệu photo 2 (`banner-2.jpg`); the lists are `HOME_BANNER` / `ABOUT_BANNER` in `lib/banner.ts` (add more photos to a list and it becomes a cross-fading slider with arrows and dots: 5.5 s per photo, paused on hover/focus, still under `prefers-reduced-motion`). Each photo is shown **whole** (`object-fit: contain`, never cropped or stretched) over a blurred copy of itself that fills the space beside it, with soft left/right edges and a slow zoom. The photo melts into the colour block on its left edge; on phones it sits above the copy. Styles: `styles/banner-sc.css`.
- **Giới thiệu copy:** the banner shows the short description ("Sắc Chằm mang nét duyên nón lá Làng Chuông…") and "Câu chuyện của chúng tôi" shows the five approved paragraphs in full (Làng Chuông origin, the question of today's young people, keychains and hair clips, and the closing about "Chằm nét xưa, gài duyên nay"). The text is written in `landing-experience.tsx`, not in the admin landing settings; the earlier "Xem thêm" button under it was removed because the whole story is now on the page.
- **Giới thiệu `/` now lives in the site shell** (`app/(site)/page.tsx`) like every other page: the same header (search, wishlist, account, cart icons, "Sản phẩm" dropdown), mobile menu, search panel, cart drawer and contact footer. The separate full-screen landing header/footer and the `(landing)` layout were removed.
- **Sticker tab of the designer:** "Sticker" lists each sticker as a row (name, price per piece) with five colour tiles (a thumbnail of that sticker in that colour); a tile adds it in that colour, with a count badge and a minus button. "Chữ" types a word into candy letters (default font "Kẹo bong bóng"). The home "Tự thiết kế" banner draws the same stickers and the letters "CHAM" with the designer's renderer.
- **Designer clean-up:** letters have one style only (the candy letters), so there is no font choice and no "Ngang/Dọc" sliders (letters and stickers are placed by dragging). The "Đã chọn" list and the price lines group identical items with "×n" (the ✕ removes one at a time). Candy letters are drawn with a puffy body, darker rim, top-left highlight, bottom-right shade and a glossy blob, to match the sticker sheet. **Checkout:** the right column (coupon, order summary, order button) is sticky under the header while the form scrolls; the receiving phone field shows a format error and the order button stays disabled until it is a valid Vietnamese mobile number.

- **Admin orders filter:** "Trạng thái" lists the statuses in lifecycle order — Chờ xác nhận, Chờ thanh toán, Đã thanh toán, Đã xác nhận, Đang chuẩn bị, Sẵn sàng giao, Đang giao, Hoàn tất — followed by the side branches (cancellation, cancelled, failed, expired, refunds). `DRAFT` is not offered (orders are never stored as drafts).
- **No articles:** there is no "Bài viết" menu item, public page or admin screen.
- **Checkout payment:** only cash on delivery (COD) is offered; the VNPay/QR option is hidden from the form. The online-payment backend stays in place but unused; `POST /v1/orders` still accepts `VNPAY`, so re-adding the option is a UI change only.

- **Page pictures are admin-configurable:** Admin → "Ảnh Trang chủ và Giới thiệu" (`/admin/page-images`, `settings:write`) changes the product-type card pictures and the "Về Sắc Chằm" picture on Trang chủ, and the story strip (3) and "Giá trị cốt lõi" (4) pictures on Giới thiệu. Each slot can be reset to the built-in picture. Text stays in code. Public media serves the `pages/` prefix through the `/media` rewrite.
- **Custom options admin layout:** "Chữ" (on/off switch, letter height, price per letter, max letters per typing) and "Số lớp trên sản phẩm" (max layers; empty = unlimited) are separate cards. Turning text off hides the "Chữ" tab in the designer.
