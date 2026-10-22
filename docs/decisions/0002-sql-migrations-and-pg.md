# 0002 — Plain SQL migrations and `pg`

**Status:** accepted (Phase 1)

## Context

Orders, inventory and payments need explicit transactions, conditional updates, CHECK constraints and triggers (append-only ledgers). Migrations must be reviewable (`data-model.md`).

## Decision

- Forward-only SQL files in `database/migrations/NNNN_name.sql`, applied by `database/src/migrate.ts` in a transaction each, checksummed (editing an applied file fails), guarded by an advisory lock.
- Each migration documents forward steps, validation query and rollback/roll-forward.
- API talks to PostgreSQL through `DatabaseService` (`pg.Pool`) and repositories written in SQL.

## Alternatives

Prisma/Drizzle: nicer typing, but hides the locking/constraint SQL this domain depends on and adds a generated layer.

## Consequences

Row typing is manual (covered by integration tests against real PostgreSQL). Revisit a query builder (e.g. Kysely) if repository SQL grows unwieldy; the repository ports make that local.
Search uses `unaccent` and sorting uses ICU collation `vi-VN-x-icu`; managed Postgres must provide both.
