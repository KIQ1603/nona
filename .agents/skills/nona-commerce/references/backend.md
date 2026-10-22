# Backend specification

## Layering

Each NestJS module follows:

```text
presentation    controllers, guards, DTO translation
application     use cases, transaction coordination, ports
domain          entities, value objects, policies, state transitions
infrastructure  repositories, cache, queues, provider adapters
```

Business rules belong in domain/application layers. Controllers stay thin. Repositories do not expose unrestricted ORM objects across module boundaries.

## Authentication and authorization

- Use server-managed sessions or short-lived access plus rotating refresh tokens in secure cookies; record the selected design in an ADR.
- Normalize email before uniqueness checks.
- Hash passwords with Argon2id using reviewed parameters.
- Revoke sessions on password reset and sensitive account changes.
- Enforce role/permission policies plus resource ownership.

## Transactions and concurrency

Define transaction scope in application services. Inventory and payment operations use database constraints and locking/conditional updates, not only process locks. Retry only known transient conflicts with bounded attempts. Never blindly retry non-idempotent provider calls.

## Queues and outbox

Use jobs for email, image processing, provider synchronization, and reconciliation. Persist an outbox record in the business transaction when delivery matters. Workers are idempotent, use bounded exponential retry, and send exhausted work to a dead-letter path with alerting.

## Cache

Cache catalog reads where useful with explicit keys and bounded TTLs. Invalidate after successful commits. Redis outages may reduce performance but must not corrupt orders. Do not cache authorization or checkout totals without a precise invalidation design.

## Files and media

Use short-lived signed URLs or controlled streaming. Validate claimed and detected MIME type, size, dimensions, and ownership. Generate safe object keys; never use raw filenames as paths. Store derivative metadata and processing state.

## External providers

Wrap payment, email, storage, and shipping SDKs behind ports. Configure timeouts, correlation IDs, retry classification, and sandbox adapters. Store redacted metadata needed for support without logging secrets or sensitive payloads.

## Observability

- Structured logs include request/job ID, permitted actor ID, operation, duration, and normalized error code.
- Metrics cover latency, errors, checkout failures, payment callbacks, queue lag, dead jobs, and inventory conflicts.
- Propagate correlation IDs through API, outbox, and workers.
- Health endpoints distinguish liveness from readiness.

## Acceptance

For each use case verify authorization, validation, happy path, idempotent retry, invalid state, concurrency-sensitive failure, and emitted jobs/events. Integration tests use a real PostgreSQL-compatible database for transactions and constraints.
