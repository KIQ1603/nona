# Commerce domain rules

## Money and pricing

- Store VND as non-negative integers. Never use floating point.
- Product display prices are informative; checkout totals are recalculated by the backend.
- Calculation order: base variant price, customization additions, item promotion, order promotion, shipping fee, final payable total.
- Every discount records its source and amount. Final totals cannot be negative.
- Order items snapshot product name, variant name, SKU, unit price, quantity, discount, customization, and image reference.

## Catalog and inventory

- A purchasable item is an active product variant with a unique SKU.
- Published products require a name, slug, category, at least one image, and one active variant.
- Inventory movements are append-only. Cached availability must reconcile to movements and reservations.
- Checkout reserves stock for a configured expiry window. Failure, expiry, or cancellation releases it.
- Prevent overselling with a transaction plus database conditional update or lock; a prior UI check is insufficient.

## Cart

- Guest carts use an opaque cookie identifier; authenticated users have a server cart.
- On login, merge carts by SKU/customization identity, capped by current availability.
- Refresh cart prices before display and always revalidate them at checkout.
- Inactive or unavailable items remain visible with an explanation but cannot be checked out.

## Promotions

- All promotion content and thresholds (announcement text, free-shipping threshold, coupons) are admin-configured data in the database. Code never hard-codes an offer; the backend reads the current configuration when quoting and creating orders.

- Coupons have activation windows, usage limits, per-user limits, eligibility, and optional minimum order value.
- Coupon validation is deterministic and repeatable inside order creation.
- Record the applied rule/version on the order; later edits never alter past orders.
- Promotion stacking is disabled unless explicitly permitted.

## Custom nón designs

- A design belongs to one owner or an unguessable guest token.
- Editing creates versions; never mutate the version attached to an order.
- Each version stores canvas/configuration data, selected variant, layers, assets, price additions, preview object key, and status.
- States: `DRAFT -> SUBMITTED -> APPROVED | REVISION_REQUIRED -> ARCHIVED`.
- Checkout accepts an immutable snapshot. If approval is required, production cannot begin before approval.
- Uploaded assets require type/size validation, safe storage, and moderation status.

### Implemented behaviour (Phase 6)

- **Options are admin data** (`site_settings.custom`): enabled flag, `requireApproval`, max layers/text length, SVG-path or picture motifs (with price), text and image surcharges. Seeded values are sample data. Only fonts are a code allow-list (they must exist on the render host).
- **Price** = backend variant price + `priceDesign()` additions, computed by the server at **submission** and frozen on the version (`price_addition_vnd`). Later option/price edits never change a submitted version. The browser uses the same pure function only for an estimate.
- **Content freeze:** only `DRAFT` versions are mutable; a database trigger rejects any change to a submitted version's content, layers or preview, and allows only `SUBMITTED -> APPROVED | REVISION_REQUIRED` and `APPROVED | REVISION_REQUIRED -> ARCHIVED`. Editing an approved/revised design creates version N+1 (copy of layers); an `APPROVED` version stays orderable until archived. A version awaiting review cannot be edited or re-versioned (409).
- **Approval (default OFF):** `custom.requireApproval=false` -> a submitted design is `APPROVED` at once, together with the pictures the customer uploaded; the order contains the hat and the customised items and staff only run the normal order statuses (CONFIRMED -> PROCESSING -> READY_TO_SHIP -> SHIPPING -> COMPLETED). With it ON, designs and pictures wait as `SUBMITTED`; staff approve or request a revision (note required) from the Designs tab (inline status menu) or the design page, and uploaded images can be rejected individually. Migration 0013 flipped the stored option and cleared the existing queue.
- **Ordering:** a customer designs on the product they came from (no title, no email needed) and orders immediately: the design is saved, submitted (frozen, price fixed) and added to the cart in one step. A `SUBMITTED` or `APPROVED` version owned by the shopper and matching the cart variant can be ordered (404 for other owners, 409 `DESIGN_NOT_APPROVED` for drafts/revision/archived). A cart line whose version leaves those states is flagged `DESIGN_UNAVAILABLE` and blocks checkout. The order email is stored as the design's contact so review notices reach guests. Plain and customised lines of the same variant are separate cart lines.
- **Order snapshot:** `order_items.customization` stores title, version, variant name (the hat colour is the variant), layer summaries and price lines at order time; it is never rewritten. Anyone holding only the order link sees a redacted summary (no layer text/title); owner and staff see all of it.
- **Production gate (only when approval is ON):** staff approval happens after the order and before production: `CONFIRMED -> PROCESSING` fails with 409 `DESIGN_NOT_APPROVED` unless every design version on the order is `APPROVED` (a revision request keeps the order blocked and emails the customer). The admin order page shows the snapshot and preview as the work order.
- **Availability:** every product is customizable by default (migration 0008, admin create form defaults on); an admin can switch it off per product. Each product page shows a "design your own" entry that opens `/thiet-ke-non?sanpham=<slug>&v=<variantId>` with that base preselected. The customer picks a variant (colour) with its thumbnail; the motif picker is a grid built from the admin options. There is no ink/text colour option: text is drawn in a fixed ink with a light outline.
- **Charms are fixed-size, draggable, rotatable:** motifs and uploaded images cannot be resized. They render at a constant share of the hat (`CHARM_SIZE`: ~10 x 10 cm on a 40 x 30 cm hat, i.e. a quarter of its width); the API stores scale 1 whatever a client sends. The customer drags them on the preview (position x/y within the hat box, keyboard arrows too) and rotates them (-180..180 degrees) with a knob, a slider or 15-degree steps and can add several at once from the charm grid, which shows a count badge per charm, a minus button to remove one, and a "remove all" action. Only text keeps adjustable size.
- **Shop-supplied artwork:** charms are either an SVG path or an uploaded picture; each variant of a product has its own picture (SVG or raster) uploaded with the product; the designer canvas is the selected variant's picture. Whatever the admin uploads (SVG, PNG, WebP, JPEG, any size up to 8MB; SVG up to 300KB) is normalised by the server: charms become a trimmed 256x256 transparent WebP, product/variant pictures are bounded to 1600px and kept whole. Blank/one-colour files are refused. SVG is **refused, never cleaned**, if it contains script, event handlers, embedded images, external references, entities or `url()` to anything but `#id`.
- **Hat picture = variant picture:** layer coordinates (0..1) refer to the picture's own box (aspect preserved), layers are clipped to the picture's alpha. There is no hat-colour option or surcharge; colour differences are different variants (and prices) with their own pictures. Without any picture the generic drawn hat is used. Charm pictures always keep their own colours.
- **Ownership:** guests are identified by an HttpOnly cookie (`nona_design`, only its hash stored); on login/register guest designs and uploads move to the account. Strangers get 404.
- **Customer communication:** every review decision enqueues an outbox email (`design.reviewed`) with the note.
- **Previews** are rendered server-side (`renderHatSvg` -> sharp PNG) and stored privately; they are streamed only to the owner or staff with `designs:read`. The render host needs Vietnamese-capable fonts.

## Order lifecycle

```text
DRAFT -> PENDING_PAYMENT -> PAID -> CONFIRMED -> PROCESSING
      -> READY_TO_SHIP -> SHIPPING -> COMPLETED

PENDING_PAYMENT -> PAYMENT_FAILED | EXPIRED | CANCELLED
PAID | CONFIRMED -> CANCELLATION_REQUESTED -> CANCELLED
PAID -> REFUND_PENDING -> PARTIALLY_REFUNDED | REFUNDED
```

- **Deliberate exception (COD, Phase 4):** a cash-on-delivery order has no payment step, so it is created directly in `CONFIRMED` (history `null -> CONFIRMED`) with a `PENDING` COD payment; the payment becomes `PAID` when the order reaches `COMPLETED` (cash collected). The `DRAFT -> PENDING_PAYMENT -> PAID` path is used by online payments (Phase 5).
- Allowed fulfilment moves: `CONFIRMED -> PROCESSING -> READY_TO_SHIP -> SHIPPING -> COMPLETED`; `CONFIRMED | PROCESSING | READY_TO_SHIP -> CANCELLED` (reason required, stock returned). A customer may cancel only in `CONFIRMED`. The table lives in `packages/contracts` (`ORDER_TRANSITIONS`) and is enforced by the API.
- Every transition is validated, timestamped, attributed, and appended to order history.
- Do not skip states to simplify UI. A privileged correction needs a reason and audit record.
- Order creation, item snapshots, totals, stock reservation, and initial history are atomic.
- Public order codes are distinct from internal primary keys.

## Online payment (VNPay)

- Created as `PENDING_PAYMENT` with an `ACTIVE` reservation until `payment_expires_at` (admin setting `checkout.paymentWindowMinutes`). A failed attempt keeps the order payable until then (**deliberate: `PAYMENT_FAILED` is reserved and unused**); the customer may open a new attempt.
- Verified success: `PENDING_PAYMENT -> PAID -> CONFIRMED` (system actor), reservation becomes a sale. Expiry: `PENDING_PAYMENT -> EXPIRED`, hold and coupon released.
- Late success on `EXPIRED`: revive if stock remains, else `PAID -> REFUND_PENDING` with an automatic full refund. Success on a `CANCELLED` order or a second success on a paid order: automatic refund of that payment.
- Cancelling a paid online order: `REFUND_PENDING -> REFUNDED`. Finance may refund part of a completed order: `COMPLETED -> PARTIALLY_REFUNDED -> REFUNDED` (extension of the lifecycle; every refund is audited).
- A refund is sent to the provider at most once; unknown outcomes are resolved manually and audited.

## Coupons and shipping (admin-managed data)

- Types: percent (optional cap), fixed amount, free shipping. Rules: activation window (start inclusive, end exclusive), minimum goods subtotal, total and per-customer limits (accounts by id, guests by email). One coupon per order; no stacking.
- Evaluation is deterministic and repeated inside the order transaction under a lock on the coupon row. Orders store `order_discounts` with the rule version applied; later edits never change past orders. Usage is `RELEASED` when an order is cancelled/expired.
- Shipping terms resolve per destination: first matching zone (province compared ignoring case and diacritics), otherwise the default fee/threshold. All values live in `site_settings.shipping`.

## Stock availability and reservations

- Available = ledger sum minus ACTIVE, unexpired reservations (`inventory/infrastructure/availability.ts`); catalog, cart and checkout all use it.
- Order creation locks the variant rows in id order, then reads availability in a **separate statement** (a new snapshot). Computing availability in the locking statement itself oversells under READ COMMITTED.
- COD sells stock immediately: a CONSUMED reservation plus a negative SALE movement. Cancelling appends a RELEASE movement exactly once. Online payments (Phase 5) use ACTIVE reservations that expire; the worker marks them EXPIRED.
- Checkout total: the client sends `expectedTotalVnd`; if the live total differs the API answers `409 PRICE_CHANGED` and creates nothing.

## Payment

- `PENDING_PAYMENT` is not paid, and redirect success pages never confirm payment.
- Verify provider signature, merchant, amount, currency, and transaction reference.
- Process callbacks idempotently using a unique provider event or transaction key.
- Store normalized status and minimal provider references; avoid sensitive payment data.
- Reconcile unresolved payments on a schedule.

## Cancellation and refund

- Cancellation eligibility depends on fulfillment state and policy, not frontend visibility.
- Stock release and order-state change must remain consistent.
- Refund records are append-only. A refund state changes only after provider confirmation or an authorized, audited manual operation.
- **Text and own pictures are optional per shop:** `custom.allowText` and `custom.allowImage` (default true) let the shop restrict customers to charms only; when off the designer hides the buttons and `validateDesign` refuses such layers. Text/image surcharges only apply when enabled; the total is variant price + charm prices (+ text/image surcharges).
- **Real proportions (migration 0015):** `products.hat_width_cm` (approximate hat width, 5–100 cm, optional; 40 cm assumed when empty) and `custom.motifs[].sizeCm` / `custom.imageSizeCm` (charm / own-picture width in cm, default 10) are admin data. A charm is drawn at `charmUnits = sizeCm / hatWidthCm * (hat picture width on the canvas)`, clamped to 14 units .. 90% of the hat; the server preview, the live editor and the drag handles share this one function. The hat picture is assumed to span the hat edge to edge (admins crop it close). Only relative proportion matters, not precision.
- Optional `products.hat_height_cm` (migration 0016, 3–100 cm) is only a fallback yardstick when the width is empty; width always wins.
- **Charm width and height:** each charm has `sizeCm` (width) and `heightCm` (null = square). `charmBox()` turns both into canvas units with the same cm-to-canvas ratio; picture charms are drawn `meet` inside that rectangle and path charms are scaled non-uniformly. Charm uploads keep their own proportions (longest side 256px, no square padding); the admin form suggests the height from the picture's proportions.
- **Hat pictures are cut out on upload:** an image attached to a variant has its flat studio background (all four corners the same colour) made transparent from the edges inwards and its empty margins trimmed (min 200px), so the canvas shows only the hat. Transparent or SVG hats are only trimmed. Gradient or busy backgrounds are not removed: the shop should upload a PNG/SVG with a transparent background.

- **Phone verification before ordering (default ON):** `checkout.requirePhoneVerification` (admin: Settings > Đặt hàng và thanh toán). The phone of the shipping address must be proven with an OTP by the buyer: signed-in users (account phone or any number they verified) and guests (proof tied to the cart cookie, valid 24 h). `POST /v1/orders` refuses with 409 `PHONE_NOT_VERIFIED` otherwise, before any stock is reserved; the quote carries `phoneVerificationRequired`. The checkout shows the verification right under the delivery details and disables the order button until it is done.
- **Who sends the phone code:** our SMS pipeline (Zalo ZNS / eSMS via the outbox) or, when the Firebase variables are set, Firebase Phone Auth in the browser. The rules above (verified phone before ordering, guest proof 24 h, one verified number per account, sign-up/reset by phone) are the same either way; only the proof differs (our code vs the Firebase ID token verified by the API).

- **Charms only (migration 0021):** customers decorate the hat with the shop's charms; the designer has no text or picture upload and the admin "Tùy chọn NONA Custom" page only manages charms (code, name, picture, size, price). `enabled`, `requireApproval=false`, `allowText=false`, `allowImage=false` stay in the settings row. The order snapshot records each charm's **code and name** (`layers[].charmCode`, `charmName`, summary "Charm {name} (mã {code})").
- **Paying for part of the cart:** `POST /v1/checkout/quote` and `POST /v1/orders` accept `lineIds` (cart line ids). Only those lines are priced, reserved and ordered; the other lines stay in the cart; the coupon is spent by the order. `/thanh-toan?chon=id1,id2` carries the selection.
- **Account emails (outbox):** `auth.welcome` (sign-up, with an email verification code), `auth.email_otp`, `auth.password_changed` (change or reset). Email verification: `users.email_verified_at`, `email_otps` (migration 0022); `GET /v1/me/email`, `POST /v1/me/email/otp|verify`. Changing or resetting a password needs `confirmPassword` equal to `newPassword`.

- **Google sign-in rules:** a known Google identity (`user_identities`, migration 0023) signs in. An unknown one creates a CUSTOMER whose email is already confirmed by Google (`email_verified_at` set, welcome email, unusable random password: "Quên mật khẩu" lets them set one). **If the email already belongs to any account (password or staff) the sign-in is refused and nothing is linked**, because linking by email would let whoever controls that Google address take over an account whose email was never confirmed. Staff cannot sign in with Google. Unverified Google emails are refused. Phone verification before ordering still applies.

- **Sign-up needs a code, whatever the method:** email, phone or Google. Email/phone sign-up is two steps and the account exists only after the correct code (`auth_challenges`, migration 0024). A phone account has no email (`users.email` nullable): its orders have no email address and email notifications are skipped, its confirmed phone counts as verified at checkout, and it signs in / resets its password with the phone. Ordering still requires a verified receiving phone.
