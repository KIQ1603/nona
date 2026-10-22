# 0003 — Server-side sessions, CSRF and same-origin API proxy

**Status:** accepted (Phase 2)

## Context

`backend.md` allows server-managed sessions or rotating tokens in secure cookies and requires an ADR for the choice. The admin UI performs privileged writes.

## Decision

- Opaque 256-bit session tokens in an HttpOnly, SameSite=Lax (Secure in production) cookie; the database stores only SHA-256 hashes, so a DB leak does not yield usable sessions. Sessions can be revoked server-side (logout, disabled user).
- CSRF: per-session token sent as `X-CSRF-Token` on every authenticated write, plus an `Origin` allow-list on all state-changing requests (also covers login CSRF).
- The browser calls the API through Next's same-origin `/api/*` rewrite so the cookie is first-party and the API needs no wide CORS.
- Argon2id (19 MiB, t=2, p=1) for passwords; unknown-email logins burn equivalent CPU; failed logins are throttled per ip+email (in memory; move to Redis before multi-replica) and audited.
- Roles map to permissions in `@nona/contracts`, enforced by a global guard (`@RequirePermission`); routes without a decorator are public.

## Alternatives

JWT access+refresh (harder revocation, more moving parts); direct cross-origin cookies (needs credentialed CORS).

## Consequences / rollback

Each request that needs auth costs one indexed session lookup. `last_seen_at` is touched at most once a minute. Switching to another scheme only touches `AuthService` and the guard.
