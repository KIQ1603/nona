# Architecture specification

## Goal

Build a production commerce system for NONA that supports a Vietnamese storefront, administration, inventory, checkout, online payment, fulfillment, and custom nón designs without premature distributed-system complexity.

## System shape

Use a monorepo with independently deployable applications:

```text
apps/web              Next.js storefront and admin UI
apps/api              NestJS modular-monolith REST API
apps/worker           Background jobs using the same application/domain packages
packages/contracts    Shared public DTO types and validation schemas
packages/config       Shared lint and TypeScript configuration
database              Schema, migrations, and seed data
infrastructure        Local containers and deployment configuration
```

Runtime dependencies:

- PostgreSQL is the transactional source of truth.
- Redis provides cache, rate-limit counters, short-lived state, and job transport. It is never the sole copy of business data.
- S3-compatible object storage holds product and design assets; the database stores object keys and metadata.
- A background worker handles email, image processing, provider retry, and scheduled reconciliation.

## Boundaries

Frontend may format and optimistically display data, but cannot authoritatively calculate checkout totals, permissions, inventory, or payment state.

Backend modules own their data and rules. Cross-module work goes through public application services rather than importing another module's repositories. Initial modules:

```text
auth, users, catalog, inventory, cart, promotions, orders,
payments, shipping, custom-designs, media, notifications, admin, audit
```

Controllers translate HTTP input. Application services coordinate use cases. Domain services enforce rules. Repositories isolate persistence. Provider adapters isolate external APIs.

## Dependency rules

- Domain code must not import controllers, request objects, ORM types, or vendor SDK types.
- Provider payloads stay inside adapters.
- Shared contracts contain public DTOs and validation, not database models or business logic.
- Workers invoke the same application services as the API where practical.
- Do not query another module's tables directly as a shortcut.

## Deployment topology

Local development uses containers for PostgreSQL, Redis, object storage, and mail capture. Web, API, and worker may run as local processes.

Production runs web, API, and worker as separate services behind TLS and a reverse proxy/CDN. Prefer managed PostgreSQL and object storage. Development, staging, and production use separate credentials and data.

## Scaling rule

Scale stateless web/API/worker replicas first. Extract a microservice only when ownership, load isolation, independent release cadence, or fault isolation is demonstrated by measurements. Record extraction as an architecture decision with data ownership and failure handling.

## Architecture decisions

Create `docs/decisions/NNNN-short-title.md` for changes to runtime boundaries, data ownership, authentication, payment providers, deployment platform, or public compatibility. Include context, decision, alternatives, consequences, and rollback/migration plan.
