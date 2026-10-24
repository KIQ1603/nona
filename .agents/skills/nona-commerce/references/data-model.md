# Data model specification

## Conventions

- Use UUID/ULID-style internal identifiers consistently; public order codes are separate.
- Store timestamps in UTC with timezone-aware types.
- Use `created_at` and `updated_at`; use `deleted_at` only where recovery or retention requires soft deletion.
- Prefer explicit status enums or constrained strings. Add foreign keys, unique constraints, and checks for critical invariants.
- Store money as integer VND amounts with names such as `unit_price_vnd`.
- Production schema changes use reviewed migrations. Use expand/backfill/switch/contract instead of destructive one-release changes.

## Core relationships

```text
users 1--* addresses
users 1--* sessions
users 1--* carts 1--* cart_items
categories 1--* products 1--* product_variants
products 1--* product_images
product_variants 1--* inventory_movements
product_variants 1--* inventory_reservations
users 1--* orders 1--* order_items
orders 1--* order_status_history
orders 1--* payments
orders 1--* shipments
custom_designs 1--* custom_design_versions
custom_design_versions 1--* design_layers
order_items *--0..1 custom_design_versions
coupons 1--* coupon_rules
coupons 1--* coupon_usages
users 1--* audit_logs
```

## Table responsibilities

- `users`: normalized email, Argon2id hash, role (`CUSTOMER`, `SUPPORT`, `CATALOG`, `FULFILLMENT`, `FINANCE`, `ADMIN`), status.
- `sessions`: hashed token, CSRF token, expiry, revocation. `idempotency_keys`: key bound to user + operation + request hash + stored response.
- `addresses`: per-user shipping addresses (free-text ward/district/province; at most one default per user, enforced by a partial unique index).
- `carts` / `cart_items`: one active cart per user or per guest token hash; `seen_price_vnd` powers price-change notices. Merged guest carts are deleted.
- `wishlist_items`: (user, product) favourites.
- `orders` / `order_items`: order totals (CHECK `total = subtotal - discount + shipping`) and an immutable commercial snapshot per item (name, SKU, price, quantity, image). `order_status_history` and `inventory_movements` are append-only (trigger). `payments`, `shipments` hang off the order; items and history use ON DELETE RESTRICT.
- `inventory_reservations`: quantity held for an order; `ACTIVE` + unexpired reduces availability.
- `outbox_events`: transactional outbox (PENDING/SENT/DEAD) delivered by the worker; payloads are scrubbed after delivery. `password_reset_tokens`: hashed single-use tokens (1 hour).
- `coupons`, `coupon_usages`, `order_discounts`: admin-managed promotions, one APPLIED/RELEASED usage per order, and the per-order discount record with rule snapshot. `carts.coupon_code` holds the selected coupon.
- `payment_events`: deduplicated provider facts (unique `provider, event_key`). `refunds`: append-only (trigger allows only PENDING -> SUCCEEDED/FAILED and stamping `attempted_at` once). `payments.refunded_vnd <= amount_vnd`.
- `user_mfa`: TOTP seed (AES-256-GCM), replay counter and hashed recovery codes. `sessions.mfa_restricted`.
- `order_status_history.seq`: strict insertion order (several transitions can share one transaction timestamp).
- `site_settings`: admin-managed business configuration (announcement, free-shipping threshold, later coupon/shipping rules) with a version. Promotions are data, never constants.

- `products`: merchandising identity, description, slug, state, category, SEO metadata.
- `product_variants`: SKU, options, price, active state, weight and dimensions.
- `inventory_movements`: append-only receipts, sales, releases, returns, and adjustments.
- `inventory_reservations`: quantity, expiry, cart/order relation, release/consume state.
- `orders`: customer/address snapshots, totals, currency, state, public code.
- `order_items`: immutable commercial snapshot and optional design-version reference.
- `payments`: provider, amount, state, provider references, idempotency key, redacted metadata.
- `order_status_history`: from/to state, actor, reason, metadata, timestamp.
- `audit_logs`: actor, action, target, change metadata, request identifier when appropriate.

Phase 6 tables (migration 0007): `design_assets` (owner, object key, moderation status), `custom_designs`, `custom_design_versions` (frozen price addition, preview key, review fields), `design_layers` (kind TEXT/MOTIF/IMAGE, bounded x/y/scale/rotation), `products.is_customizable`, `cart_items.design_version_id` (unique per cart + variant + design), FK `order_items.design_version_id`. Triggers make submitted versions and their layers immutable.

`articles` (migration 0011): slug (unique), title, excerpt, body (<= 60k chars), cover object key/size/alt, status DRAFT|PUBLISHED|ARCHIVED, author, SEO fields, `published_at`, optimistic `version`. A CHECK guarantees a published row has a date, a cover and a body. Article images live under `articles/` in the object store, which (with `products/`) is the only publicly readable prefix; production buckets must carry the same policy.

`product_images.variant_id` (migration 0014, nullable FK, ON DELETE SET NULL): the picture of one variant (each colour owns its hat picture; a variant-less image is a general gallery picture). The former `products.design_base_*` columns were migrated into it and dropped; `site_settings.custom` lost `colors`, `inks` and `motifs[].recolor`; `custom_design_versions.hat_color_id` is a legacy NOT NULL column that now stores `-`. Public-read prefixes of the object store are now `products/`, `articles/` and `custom/` (charm and hat pictures); `designs/` stays private.

## Critical constraints and indexes

- Unique normalized user email, category slug, product slug, variant SKU, public order code, and payment provider transaction key.
- Quantities are greater than zero; monetary amounts are non-negative; reservation expiry follows creation.
- Restrict deletion of records referenced by orders/payments. Cascade only disposable children such as draft layers.
- Never hard-delete paid orders, payments, inventory movements, or audit logs in ordinary flows.
- Index product publication/category/slug, variant SKU, reservation variant/state/expiry, order user/state/code/created time, payment provider reference/status, design owner/status, and outbox processing status.

## Transaction boundaries

- Order creation plus item snapshots, totals, reservation, and history.
- Payment callback deduplication plus payment/order transition.
- Reservation consumption/release plus inventory movement.
- Refund recording plus payment/order transition.

## Migration acceptance

Each production migration states forward steps, data backfill, compatibility window, validation query, and rollback or roll-forward strategy. Rehearse high-volume rewrites and new restrictive constraints in staging.

`users.phone` (E.164, CHECK) and `users.phone_verified_at` (migration 0018); a partial unique index lets only one account own a verified number. `phone_otps`: user, phone, keyed hash of the code (HMAC-SHA256 with `OTP_SECRET`, never the code), attempts, expiry, consumed_at; rows older than 2 days are removed by the worker cleanup.

Migration 0019: `phone_otps` can belong to a guest (`guest_token_hash`, exactly one owner), has `purpose` (ACCOUNT|CHECKOUT) and `ip`; `verified_phones` (user or guest owner, phone, verified_at; unique per owner+phone) records numbers proven at checkout.

Migration 0024: `users.email` is nullable (CHECK: email or phone), unique login index on confirmed phones, `orders.customer_email` nullable, and `auth_challenges` (purpose REGISTER|RESET, channel EMAIL|PHONE, identifier, pending full name and password hash, keyed hash of the code, attempts, expiry, ip) holds pending sign-ups and phone resets; nothing in `users` changes until the code is right.
