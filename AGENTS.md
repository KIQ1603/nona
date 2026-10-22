# NONA project instructions

This repository is the production-oriented NONA commerce system. The current static shop is a visual prototype; preserve its Vietnamese brand direction while migrating features into the production architecture.

## Required workflow

1. Read `.agents/skills/nona-commerce/SKILL.md` before architecture, frontend, backend, database, checkout, payment, security, testing, or deployment work.
2. Read every reference routed by the skill for the current task.
3. State assumptions when a product decision is unspecified. Do not silently invent business policy.
4. Keep changes scoped. Do not introduce microservices, a second source of truth, or a new framework without an accepted architecture decision.
5. Update the relevant specification in the same change when behavior, data contracts, state transitions, or operational requirements change.

## Non-negotiable invariants

- Backend-calculated price, discount, shipping fee, inventory, payment, and order totals are authoritative.
- Store money as integer VND amounts; never use floating-point values for money.
- Preserve purchased product name, SKU, price, discount, and customization snapshots on order items.
- Confirm online payments only from a verified, idempotent provider callback or reconciliation process.
- Make inventory reservation and order creation transactional.
- Never expose secrets, password hashes, raw payment credentials, or internal stack traces.
- Require authorization on every admin operation and audit material admin actions.
- New behavior needs proportionate automated tests and a clear production-data migration path.

Canonical specifications live in `.agents/skills/nona-commerce/references/`. Do not create competing copies elsewhere.
