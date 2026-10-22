# Quality and testing specification

## Test layers

- Unit: pricing, promotion eligibility, state transitions, value objects, and pure validation.
- Integration: repositories, migrations, constraints, transactions, inventory races, outbox, and provider adapters.
- API contract: schemas, authentication, authorization, error codes, pagination, and idempotency.
- End-to-end: browse, cart, login merge, checkout, COD, payment callback/return, tracking, admin fulfillment, and custom design.

## Regression rule

A bug fix adds a test that fails for the reported behavior where practical. Pricing, inventory, payment, permission, or order-state changes require negative and retry/concurrency cases, not only a happy path.

## Test data

Use deterministic factories with explicit product, variant, stock, promotion, user, and time states. Never depend on production data. Freeze time for expiry rules. Provider fixtures must be sanitized and identifiable.

## Critical scenarios

1. Two checkouts compete for the last unit; at most one reserves it.
2. Repeating an order request with the same idempotency key creates one order.
3. Duplicate payment callbacks cause one payment effect.
4. A success redirect without verified callback does not mark paid.
5. A cart price changes; checkout returns the new total and user-visible explanation.
6. An expired reservation releases stock.
7. An unauthorized admin operation changes nothing.
8. An ordered custom design stays unchanged when the draft changes.
9. A failed email job does not roll back a paid order and retries safely.
10. A migration applies to a production-like snapshot and preserves history.

## CI gates

Run format/lint, type checking, unit tests, integration tests, API compatibility, production build, migration validation, dependency/security scanning, and focused end-to-end smoke tests. Do not bypass a critical failure without a recorded risk owner and recovery plan.

## Definition of done

Behavior and failures are implemented; tests pass; observability supports the feature; accessibility is checked for UI work; contracts/specifications are updated; migrations are reviewed; and deployment/rollback implications are documented.
