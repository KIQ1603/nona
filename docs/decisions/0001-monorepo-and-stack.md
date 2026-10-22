# 0001 — Monorepo layout and stack

**Status:** accepted (Phase 1)

## Context

`references/architecture.md` prescribes a pnpm monorepo: Next.js web, NestJS modular-monolith API, worker, shared contracts, PostgreSQL, Redis, S3-compatible storage.

## Decision

- pnpm workspaces: `apps/{web,api,worker}`, `packages/{contracts,config}`, `database`, `infrastructure`.
- Versions pinned exactly: Next 15 (App Router), React 19, NestJS 11, TypeScript 5.9, zod 3, Vitest 3.
- API modules follow `presentation / application / domain / infrastructure`; repositories sit behind ports (`CATALOG_REPOSITORY`).
- Web is organised by feature (`src/features/<feature>`), routes in `src/app` stay thin, shared UI in `src/components`.
- `@nona/contracts` (zod schemas) is the single source for DTOs and query validation, used by API validation and web response validation.
- Nest DI uses explicit `@Inject(...)` so tests run on esbuild (no decorator-metadata dependency).

## Alternatives

Turborepo/Nx (deferred until build times justify), Prisma/Drizzle (see ADR 0002), tRPC (REST + OpenAPI is the spec'd contract).

## Consequences / rollback

Everything is plain TypeScript packages; moving to Turborepo or splitting a package later does not change code structure.
Local ports differ from defaults to avoid collisions: Postgres 5433, Redis 6390, API 4100, web 3100.
