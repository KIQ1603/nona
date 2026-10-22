---
name: nona-commerce
description: Build, change, or review the NONA production commerce system, including storefront, admin, backend, database, checkout, payments, custom-hat designs, security, tests, and deployment. Use for implementation or architecture work in the NONA repository; do not use for unrelated static mockups.
---

# NONA Commerce

Use the specifications in `references/` as the source of truth. Preserve existing user choices and ask only when a missing business decision would materially change behavior.

## Working method

1. Identify the affected domain and read the routed references below.
2. Inspect current code, migrations, tests, and configuration before proposing changes.
3. Define behavior and failure cases before implementing orders, stock, payments, permissions, or production-data changes.
4. Implement the smallest coherent vertical slice. Keep business rules in backend domain services, not UI components or controllers.
5. Verify relevant unit, integration, contract, and end-to-end behavior.
6. Update the canonical specification when a contract, invariant, state transition, or operational procedure changes.

## Reference routing

- Architecture, repository structure, or infrastructure: read [architecture.md](references/architecture.md).
- Products, carts, promotions, checkout, orders, custom designs, or state transitions: read [domain-rules.md](references/domain-rules.md).
- Tables, relations, migrations, constraints, or indexes: read [data-model.md](references/data-model.md) and `domain-rules.md`.
- REST endpoints, DTOs, pagination, webhooks, or errors: read [api-contract.md](references/api-contract.md).
- Storefront, admin UI, accessibility, SEO, state, or design migration: read [frontend.md](references/frontend.md) and `api-contract.md`.
- Backend modules, transactions, queues, caching, or integrations: read [backend.md](references/backend.md), `domain-rules.md`, and `api-contract.md`.
- Authentication, authorization, payments, secrets, audit, monitoring, backups, or incidents: read [security-operations.md](references/security-operations.md).
- Tests, acceptance criteria, release gates, or bug fixes: read [testing.md](references/testing.md).
- Planning, milestones, environments, CI/CD, or rollout: read [delivery-roadmap.md](references/delivery-roadmap.md).

## Required invariants

- Backend and database are authoritative for price, stock, discounts, shipping, payment, and order state.
- Represent VND as integers. Make externally retried operations idempotent.
- Snapshot purchased and customized item data on the order.
- Use database transactions for coupled order and inventory changes.
- Keep the first production shape a modular monolith. Split a service only from measured need and an accepted decision record.
- Avoid breaking API or schema changes without a migration and compatibility plan.

## Conflicts

Current user instructions take precedence. Otherwise prefer domain invariants, then API/data contracts, accepted architecture, and implementation details. Record a deliberate exception in the relevant reference instead of silently diverging.
