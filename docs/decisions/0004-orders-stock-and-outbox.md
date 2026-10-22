# 0004 — Order creation, stock locking and the outbox

**Status:** accepted (Phase 4)

## Context

Orders must never oversell, must be idempotent, must keep an immutable snapshot, and must notify customers without making the order depend on an email provider (`domain-rules.md`, `backend.md`).

## Decision

- One transaction creates the order, snapshots items, appends history, writes the payment, sells the stock (SALE movement + consumed reservation), clears the cart and enqueues the `order.placed` outbox event.
- Concurrency: lock variant rows ordered by id, **then** read availability in a new statement (a fresh READ COMMITTED snapshot). The first implementation computed availability inside the locking `SELECT ... FOR UPDATE` and oversold the last unit under concurrency; the regression is covered by tests (two buyers / eight buyers for three units).
- Idempotency: `Idempotency-Key` bound to (owner, operation, request hash). Owner is the user, or the hashed guest cart token. A failed attempt rolls back its key row, so it can be retried with a corrected request.
- Money: totals are recomputed by the backend inside the transaction; `expectedTotalVnd` mismatch returns `409 PRICE_CHANGED`. Shipping fee and free-shipping threshold are admin-managed settings.
- COD orders start `CONFIRMED` (documented exception in `domain-rules.md`); online payments will start `PENDING_PAYMENT` with expiring reservations.
- Outbox: events are delivered by the worker with `FOR UPDATE SKIP LOCKED` leases, exponential backoff, a dead-letter state with an error log, and payload scrubbing after delivery. Delivery is at-least-once.
- Mail is a port (`@nona/mail`); templates escape all dynamic values.

## Alternatives

Row-level reservations for every order (heavier, no benefit for COD); `SERIALIZABLE` isolation (retries everywhere); sending email inside the order transaction (couples orders to SMTP availability).

## Consequences / rollback

A crash between sending and marking an event SENT can repeat one email. Worker and API share only the database schema and `@nona/mail`. To roll back, stop the worker (events queue up safely) and revert the API; schema changes are additive.
