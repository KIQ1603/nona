# Delivery and roadmap specification

## Environments

- Development: local services and synthetic data.
- Staging: production-like topology, provider sandboxes, migration rehearsal, and acceptance tests.
- Production: isolated data/secrets, monitored releases, backups, and restricted administration.

Never share databases or provider credentials between staging and production.

## Milestone 0 — foundation

- Monorepo, TypeScript standards, environment validation, local containers.
- Next.js web, NestJS API, worker skeleton, PostgreSQL migrations, Redis.
- Structured logging, request IDs, health endpoints, CI baseline.
- Initial design tokens and API error contract.

Exit: a deployable vertical health/sample slice works in development and staging.

## Milestone 1 — sell with COD

- Catalog, categories, variants, images, responsive shop.
- Admin catalog and inventory management.
- Guest/auth cart, address capture, backend checkout quote.
- Transactional order creation, reservation, COD, order history, fulfillment.
- Confirmation email and audit logs.

Exit: an operator can publish, receive a COD order, fulfill it, and inspect history.

## Milestone 2 — online payment and reliability

- VNPay adapter, verified idempotent webhook, reconciliation.
- Coupons, shipping calculation/integration, cancellation/refund.
- Queue monitoring, alerts, backup/restore exercise, security review.

Exit: a low-value production payment completes and reconciles end-to-end; outage and duplicate callback tests pass.

## Milestone 3 — NONA customization

- Design editor model/versioning, upload/processing, price additions.
- Submission, approval, revision, and immutable order snapshot.
- Production handoff and customer status communication.

Exit: a custom design moves from draft through approval, paid order, production, and fulfillment without mutable history.

## Delivery practice

- Prefer small vertical slices over completing all frontend before backend.
- Each slice includes schema, domain behavior, API, UI, tests, observability, and documentation as applicable.
- Deploy compatible schema changes before code that requires them. Remove fields only after all readers/writers stop using them.
- Feature flags for risky or incomplete behavior need an owner and removal date.

## Recommended first slices

1. Repository foundation and local infrastructure.
2. Read-only category/product API and migrated shop UI.
3. Admin product creation and media upload.
4. Inventory movements and availability.
5. Guest cart and authenticated merge.
6. Checkout quote and COD order creation.
7. Admin order flow and customer tracking.
8. Online payment integration.
