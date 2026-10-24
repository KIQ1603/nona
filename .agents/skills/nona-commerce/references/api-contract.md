# REST API contract

## General contract

- Base path: `/v1`.
- JSON uses `camelCase`; database naming does not leak into the API.
- Dates are ISO 8601 UTC strings. Money fields end in `Vnd` and contain integers.
- Browser sessions use secure HttpOnly cookies. Cookie-authenticated writes receive CSRF protection appropriate to the selected session design.
- Validate unknown or malformed input at the boundary.
- Never return password hashes, secrets, provider credentials, stack traces, or unrestricted database records.

Errors always use:

```json
{
  "error": {
    "code": "INVENTORY_INSUFFICIENT",
    "message": "Sản phẩm không còn đủ số lượng.",
    "details": {},
    "requestId": "req_..."
  }
}
```

Error codes are stable and machine-readable. Vietnamese messages may change without breaking clients.

## Pagination and filtering

Public catalog may use cursor pagination. Admin tables may use page pagination when totals are necessary. Bound page size, encode filters explicitly, reject unsupported sort fields, and return deterministic ordering with metadata.

## Initial endpoints

```text
GET    /v1/products
GET    /v1/products/:slug
GET    /v1/categories
POST   /v1/auth/register
POST   /v1/auth/login
POST   /v1/auth/logout
POST   /v1/auth/refresh
GET    /v1/me
GET    /v1/cart
POST   /v1/cart/items
PATCH  /v1/cart/items/:itemId
DELETE /v1/cart/items/:itemId
POST   /v1/checkout/quote
POST   /v1/orders
GET    /v1/orders/:publicCode
GET    /v1/me/orders
POST   /v1/payments/vnpay
POST   /v1/webhooks/payments/vnpay
POST   /v1/custom-designs
GET    /v1/custom-designs/:id
PATCH  /v1/custom-designs/:id
POST   /v1/custom-designs/:id/versions
POST   /v1/custom-designs/:id/submit
GET    /v1/custom/catalog                    (customizable products + admin-managed options)
GET    /v1/custom-designs                    (own designs)
POST   /v1/custom-designs/assets             (multipart `file`; image re-encoded, PENDING moderation)
GET    /v1/custom-designs/assets/:assetId/content
GET    /v1/custom-designs/versions/:versionId/preview   (owner or designs:read; PNG)
GET    /v1/admin/designs                     (designs:read; ?status&q&page)
GET    /v1/admin/designs/:id                 (designs:read)
POST   /v1/admin/designs/versions/:versionId/review     (designs:review; APPROVE | REQUEST_REVISION + note + rejectAssetIds)
GET    /v1/storefront/settings
POST   /v1/auth/forgot-password              (always 202)
POST   /v1/auth/reset-password
POST   /v1/orders/:publicCode/cancel         (owner only, CONFIRMED only)
GET    /v1/me/orders
GET    /v1/admin/orders/:id
PATCH  /v1/admin/orders/:id/status           (orders:write; body: to, version, reason?, shipment?)
GET    /v1/auth/session                      (always 200; { user: null } for guests)
PATCH  /v1/me
POST   /v1/me/password
GET    /v1/me/addresses
POST   /v1/me/addresses
PATCH  /v1/me/addresses/:id
DELETE /v1/me/addresses/:id
POST   /v1/cart/acknowledge-price-changes
GET    /v1/wishlist
POST   /v1/wishlist/items
DELETE /v1/wishlist/items/:slug
POST   /v1/wishlist/merge
GET    /v1/me
GET    /v1/admin/categories
POST   /v1/admin/categories
PATCH  /v1/admin/categories/:id
DELETE /v1/admin/categories/:id
GET    /v1/admin/products/:id
POST   /v1/admin/products/:id/variants
PATCH  /v1/admin/variants/:id
POST   /v1/admin/products/:id/images        (multipart, field "file")
PUT    /v1/admin/products/:id/images/order
DELETE /v1/admin/products/:id/images/:imageId
GET    /v1/admin/variants/:id/inventory
GET    /v1/admin/settings
PATCH  /v1/admin/settings/:key
GET    /v1/admin/audit-logs
GET    /v1/admin/products
POST   /v1/admin/products
PATCH  /v1/admin/products/:id
GET    /v1/admin/orders
PATCH  /v1/admin/orders/:id/status
POST   /v1/admin/inventory/adjustments
```

## Sessions, CSRF and admin writes

- `POST /v1/auth/login` sets the opaque `nona_session` cookie (HttpOnly, SameSite=Lax, Secure in production) and returns `{ ..., csrfToken }`. Sessions are server-side rows; only a SHA-256 of the token is stored; absolute TTL 7 days, idle TTL 12 hours.
- Every state-changing request must come from the web origin (`Origin` check) and, when authenticated, carry `X-CSRF-Token`. Browsers call the API through the web app's same-origin `/api/*` proxy.
- Product updates send `version`; a stale version returns `409 CONFLICT` with `details.currentVersion`. Publishing returns `409 PUBLISH_REQUIREMENTS_NOT_MET` with `details.issues`.
- `POST /v1/admin/inventory/adjustments` requires `Idempotency-Key`; replays return the original response with `Idempotent-Replayed: true`; a key reused with different input returns `409 IDEMPOTENCY_KEY_REUSED`.

## Carts

- Signed-in users own a server cart; everyone else is identified by the opaque HttpOnly `nona_cart` cookie (only its SHA-256 is stored). Cart routes accept both; signed-in writes require `X-CSRF-Token`.
- Every cart response is recomputed from live data: unit price, availability, `purchasable`/`issue` (`UNAVAILABLE`, `OUT_OF_STOCK`, `INSUFFICIENT_STOCK`), and `priceChange.previousUnitPriceVnd` until the shopper calls `acknowledge-price-changes`. `subtotalVnd` counts purchasable lines only and is informational; checkout recalculates.
- Adding/updating clamps to available stock (and 20 per line) and returns a `QUANTITY_ADJUSTED` notice; a sold-out variant returns `409 INVENTORY_INSUFFICIENT`.
- On `POST /auth/login` and `/auth/register` the guest cart is merged into the account (quantities summed per variant, capped by availability, unavailable lines dropped) and the guest cart is deleted.

## Checkout and orders

- `POST /v1/checkout/quote` returns lines, subtotal, discounts, shipping fee, total and blockers, all computed by the backend from live data and admin-configured shipping rules (`site_settings.shipping`: `flatFeeVnd`, `freeShippingThresholdVnd`).
- `POST /v1/orders` requires `Idempotency-Key` (guests are scoped by their cart cookie) and `expectedTotalVnd`. Errors: `409 PRICE_CHANGED` (details carry the new total), `409 INVENTORY_INSUFFICIENT` (details.items), `409 CART_EMPTY`. A retry with the same key replays the original response (`Idempotent-Replayed: true`).
- `GET /v1/orders/:publicCode` is a capability lookup (12-character unguessable code, rate-limited per IP). The owner sees full data; anyone else gets email/phone/street masked and `isOwner: false`.
- Order codes are 12 Crockford-base32 characters; the internal UUID is never exposed to customers.

## Online payments, refunds, coupons, MFA

- `POST /v1/orders` accepts `paymentMethod: "COD" | "VNPAY"`. A VNPAY order is `PENDING_PAYMENT`; the response carries `paymentUrl` (and `paymentExpiresAt`). `POST /v1/payments/vnpay { orderCode }` (needs `Idempotency-Key`) starts a new payment attempt for an unpaid, unexpired order.
- Provider webhook: `GET|POST /v1/webhooks/payments/vnpay`. Always HTTP 200 with the provider acknowledgement: `00` confirmed, `02` already confirmed (duplicate), `01` unknown reference, `04` amount mismatch, `97` bad signature, `99` other. Only a verified callback or reconciliation marks an order paid; the browser return URL never does.
- Coupons: `POST /v1/cart/coupon { code }` / `DELETE /v1/cart/coupon`; refusals are `409 COUPON_INVALID` with `details.issue` (`NOT_FOUND`, `INACTIVE`, `NOT_STARTED`, `EXPIRED`, `MIN_ORDER`, `EXHAUSTED`, `USER_LIMIT`). Admin: `GET/POST /v1/admin/coupons`, `PATCH /v1/admin/coupons/:id` (`version`; the code is immutable).
- Quote: `POST /v1/checkout/quote { province? }` applies the cart coupon and the shipping zone for the province (`shippingZone`, `coupon`, `couponIssue` in the response).
- Refunds (permission `refunds:write`, `Idempotency-Key` required): `POST /v1/admin/orders/:id/refunds { amountVnd, reason }`; `POST /v1/admin/refunds/:id/resolve { outcome, note }` for refunds the provider could not confirm.
- Staff MFA: `POST /v1/auth/login` returns `{ mfaRequired, challengeToken }` for staff with MFA; `POST /v1/auth/mfa/verify`; enrolment `POST /v1/me/mfa/{setup,confirm,disable}`. Under `REQUIRE_STAFF_MFA` a restricted session gets `403 MFA_REQUIRED` on every permissioned route.
- Operations: `GET /v1/admin/system` (permission `system:read`); `POST /v1/internal/jobs/payments-maintenance` and `GET /v1/internal/metrics` need the `x-internal-token` header.

## NONA Custom artwork (admin)

- `POST /v1/admin/custom/motif-image` (`settings:write`, multipart `file`) -> `{ imageKey, imageUrl, transparent }`; the key is then stored in `custom.motifs[].imageKey` (`path` optional; charms always keep their own colours).
- The per-product `/admin/custom/products/:id/base` endpoints were removed (migration 0014): the hat picture is a normal product image attached to a variant.
- `POST /v1/admin/products/:id/images` (`catalog:write`, multipart `file`, optional `variantId`) accepts SVG, PNG, JPEG or WebP (SVG is sanitised and rasterised; raster min 400px, output WebP <= 1600px, never trimmed). With `variantId` the image belongs to that variant and replaces the variant's previous one. Image DTOs carry `variantId|null`.
- `GET /v1/custom/catalog` returns `mediaBase` and, per variant, `image {url,width,height}|null` (the variant's own picture, else the product's first general picture). `custom` options no longer have `colors`, `inks` or `motifs[].recolor`; layers have no `inkId`; designs have no `hatColorId`.
- `GET /v1/admin/dashboard` (`orders:read`) -> revenue per day (30), week (12) and month (12) in Asia/Ho_Chi_Minh, KPIs with previous-month comparison, order-status and payment mix, top products, design counts and statuses, low-stock count. Revenue counts orders in PAID/CONFIRMED/PROCESSING/READY_TO_SHIP/SHIPPING/COMPLETED/PARTIALLY_REFUNDED.
- Stored previews are rasterised from PNG data URIs (the SVG renderer cannot decode WebP).

## Articles

- Public: `GET /v1/articles?page&pageSize(<=24)` (published only, newest first) and `GET /v1/articles/:slug` (404 for anything not published).
- Admin (`articles:write`: ADMIN, CATALOG): `GET|POST /v1/admin/articles`, `GET|PATCH|DELETE /v1/admin/articles/:id` (PATCH needs the optimistic `version`; `status` DRAFT|PUBLISHED|ARCHIVED), `POST|DELETE /v1/admin/articles/:id/cover` (multipart `file`), `POST /v1/admin/articles/images` (inline image, returns its URL).
- Publishing requires a title, non-empty body and a cover (API rule and DB check). The first publication fixes `publishedAt`; republishing keeps it. A published article cannot be deleted or lose its cover. All writes are audited.
- The body is a safe Markdown subset parsed by the shared `parseArticleBody`: headings, paragraphs, lists, quotes, images, bold/italic and links to https/mailto/tel/same-site only. No raw HTML is ever rendered.

## Landing content

- `GET /v1/storefront/landing` (public) and `PATCH /v1/admin/settings/landing` (`settings:write`, optimistic `version`): hero, story (text, up to 4 stats, https image), process steps (max 8), testimonials (max 8, https images), order copy. Unknown fields and non-https image links are rejected. See ADR 0007.

- `GET /v1/admin/orders` items also carry `version`, `allowedTransitions` and `pendingDesigns` (custom designs not yet approved), so the admin list can change a status inline with the same optimistic-locked `PATCH /v1/admin/orders/:id/status`; the order detail adds `pendingDesigns[]` too.

## Contact channels

- `site_settings.contact` (admin-managed via `PATCH /v1/admin/settings/contact`, `settings:write`): `floatingEnabled`, `headline`, `description`, `address`, `hours`, up to 10 channels `{id, kind, label, url, enabled}`. `url` must be `https://`, `mailto:` or `tel:` (never `javascript:`/`data:`). The public `GET /v1/storefront/settings` exposes it; the storefront renders pulsing floating buttons, footer links and `/lien-he` from it.

## Custom designs

- Guest ownership uses the HttpOnly `nona_design` cookie; unknown or foreign ids return 404 (never 403).
- `POST /v1/cart/items` accepts `designVersionId`; cart lines expose `design`, order items expose `customization`.
- Errors: `DESIGN_INVALID` (400, validation issues listed), `DESIGN_NOT_APPROVED` (409). Cart/quote issue `DESIGN_UNAVAILABLE`.
- Option editing uses `PATCH /v1/admin/settings/custom` (`settings:write`, optimistic `version`).

## Idempotency and concurrency

Require `Idempotency-Key` for order creation, payment initiation, inventory adjustment, and retriable writes. Bind a key to user, operation, and request hash; reject reuse with different input.

Provider webhooks use provider event/transaction identity. A duplicate returns success after confirming the prior result.

Use `409 Conflict` for stale state, duplicate operations, invalid transitions, and inventory races. Return structured detail so clients can refresh. Use versions or conditional updates where concurrent admin editing matters.

## Change policy

- Additive response fields are allowed within a version.
- Removing, renaming, or changing field meaning requires compatibility handling or a new version.
- Generate OpenAPI from backend DTOs and validate the frontend client in CI.
- Update examples and tests with the contract.
- Real sizes: product create/update/detail carry `hatWidthCm` (number 5–100 | null); `GET /v1/custom/catalog` returns it per product; `custom.motifs[].sizeCm` (width), `custom.motifs[].heightCm` and `custom.imageSizeCm` (1–60 cm) configure charm and picture widths.

## Phone verification (OTP)

- `GET /v1/me/phone` -> `{ phone: "+84 *** *** 678" | null, verified }`.
- `POST /v1/me/phone/otp {phone}` (signed in) normalises to +84, refuses a number already verified by another account (409), then queues a 6-digit code (valid 300 s). Response `{ phone, expiresInSeconds, resendAfterSeconds, devCode? }`; `devCode` exists only when `SMS_MODE=simulator` and not production. Limits: 60 s between sends, 5 per hour and 10 per day per account, 5 per hour per number (429 `RATE_LIMITED`, `details.retryAfterSeconds`).
- `POST /v1/me/phone/verify {code}` -> `{ phone, verified: true }`; wrong code 400 `TOKEN_INVALID` with `details.attemptsLeft`; the code is locked after 5 wrong tries; each code works once and only the newest is valid.
- `DELETE /v1/me/phone` removes the number. Audit actions: `account.phone_otp_sent`, `account.phone_verified`, `account.phone_removed`.

- Checkout phone proof (signed in or guest with a cart): `GET /v1/checkout/phone?phone=` -> `{phone, verified}`; `POST /v1/checkout/phone/otp {phone}` (same limits as account OTP plus 15 sends/hour per IP; 409 `CART_EMPTY` without a cart); `POST /v1/checkout/phone/verify {code}` -> `{phone, verified:true}`. A code is bound to its purpose (account vs checkout) and owner. `POST /v1/orders` -> 409 `PHONE_NOT_VERIFIED` when required and not proven; `settings.checkout` gains `requirePhoneVerification`.
- **Firebase Phone Auth** (when `FIREBASE_PROJECT_ID`, `FIREBASE_API_KEY`, `FIREBASE_AUTH_DOMAIN`, `FIREBASE_APP_ID` are set): Firebase texts the code and checks it in the browser; our server never queues an SMS. `GET /v1/auth/providers` -> `{google, phone: {provider: 'sms'|'firebase', firebase: {apiKey, authDomain, projectId, appId}|null}}` (public web config only). The browser sends the resulting ID token: `POST /v1/me/phone/firebase {idToken}` -> `{phone, verified}`, `POST /v1/checkout/phone/firebase {idToken}` -> `{phone, verified:true}`, `POST /v1/auth/register/verify-firebase {token, idToken}` -> 201 + session, and `POST /v1/auth/reset-password/phone {token, idToken, newPassword, confirmPassword}` (`code` xor `idToken`). The number is read from the token, never from the request. A challenge from `register/start` or `forgot-password` for a phone then answers `provider: 'firebase'` and no `devCode`; its token's number must equal the challenge's number. `POST /v1/me/phone/otp` -> 409 while Firebase is on. Invalid, forged, expired (> 5 min since sign-in), foreign-project or non-phone tokens -> 400 `TOKEN_INVALID`.

## Sign in with Google

- `GET /v1/auth/providers` -> `{ google: boolean }` (true when `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set).
- `GET /v1/auth/google/start?next=/path` -> 302 to Google (authorization code + PKCE, `state`, `nonce`); the transaction lives in a signed 10-minute HttpOnly cookie `nona_oauth`. `next` must be a same-site path.
- `GET /v1/auth/google/callback` (registered at Google as `<WEB_ORIGIN>/api/auth/google/callback`) always answers 302 to the web app: success -> `next` with the `nona_session` cookie set and the guest cart merged; failure -> `/dang-nhap?loi=<code>` with `google-trung-email`, `google-chua-xac-thuc`, `google-huy` or `google-loi`.

## Sign-up and sign-in with email or phone (one-time codes)

- `POST /v1/auth/register/start {fullName, identifier, password, confirmPassword}`: `identifier` is an email or a Vietnamese **mobile** number (03x, 05x, 07x, 08x, 09x; typed as `0912 345 678`, `+84912345678`, `84...`); the server classifies it. Anything else -> 400 with the reason (e.g. wrong prefix). An email/phone that already has an account -> 409. **No account is created**; a code is mailed (`auth.email_otp`) or texted (`phone.otp`). Response: `{token, channel, destination (masked), expiresInSeconds, resendAfterSeconds, devCode?}` (`devCode` only with the simulator, never in production).
- `POST /v1/auth/register/resend {token}` (60 s apart) -> a new challenge token; the previous code stops working. `POST /v1/auth/register/verify {token, code}` -> 201 and the session cookie: only now the CUSTOMER is created, with `email_verified_at` or `phone_verified_at` set (a phone account has `email = null`). 5 wrong tries lock the challenge; 5 codes per identifier and 15 per IP per hour. The old one-step `POST /v1/auth/register` was removed.
- `POST /v1/auth/login` accepts an email, a mobile number (any common format) or the bare username shortcut.
- `POST /v1/auth/forgot-password {identifier}` (`email` still accepted): an email gets the reset link; a mobile number gets an SMS code and the answer is `{ok, token, destination, ...}` whether or not the number has an account. `POST /v1/auth/reset-password/phone {token, code, newPassword, confirmPassword}` -> 204 and every session is signed out. `POST /v1/me/phone/otp` and the checkout phone proof also require a mobile number.
