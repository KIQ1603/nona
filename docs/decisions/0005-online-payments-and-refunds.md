# 0005 — Online payments, reconciliation and refunds

**Status:** accepted (Phase 5)

## Context

VNPay confirms payments by browser redirect and by a server-to-server IPN. Redirects are forgeable and IPNs can be lost, duplicated or arrive late. Money must never be taken twice, orders must not be confirmed without proof, and refunds must be safe to retry.

## Decision

- **Port/adapter:** `@nona/payments` holds all VNPay specifics (signing, URL, callback parsing, query, refund). A local **simulator** speaks the same protocol so everything runs without credentials; it is refused in production.
- **Order flow:** online orders are `PENDING_PAYMENT` with an `ACTIVE` stock reservation for an admin-configured window. A verified IPN (or reconciliation) turns the reservation into a sale and moves `PENDING_PAYMENT → PAID → CONFIRMED` (system actor). A failed attempt keeps the order payable until the window ends (`PAYMENT_FAILED` is not used). COD is unchanged (ADR 0004).
- **Idempotent settlement:** one `payment_events` row per provider fact (`success:<txnRef>`); settlement runs under row locks; duplicates return RspCode 02.
- **Edge cases:** late payment after expiry → revive if stock remains else refund; payment for a cancelled order → refund; second successful attempt → refund of the duplicate.
- **Reconciliation:** the worker only _schedules_; `payments-maintenance` (API) queries the provider for stale pending payments, expires unpaid orders and releases holds/coupons. Provider answers that are unknown or badly signed never change state.
- **Refunds:** append-only rows, capacity checked under lock, sent at most once; uncertain outcomes are resolved manually (audited). Cancelling a paid online order → `REFUND_PENDING` → `REFUNDED`; finance can refund partially after completion (`PARTIALLY_REFUNDED`).
- **Promotions & shipping are data:** coupons and shipping zones are admin-edited tables/settings; orders snapshot the applied rule version.
- **Staff MFA:** TOTP, encrypted seeds, recovery codes; production policy restricts sessions until enrolment.

## Alternatives

Trusting the return URL (insecure); refunding via automatic retry (risk of double refunds); running reconciliation logic inside the worker (duplicated rules); SMS/e-mail OTP for staff (weaker, more moving parts).

## Consequences / rollback

Real VNPay credentials and sandbox verification are required before launch (see security review #15). Rolling back = switch customers to COD (announcement bar) and stop calling `payments-maintenance`; existing rows remain valid.
