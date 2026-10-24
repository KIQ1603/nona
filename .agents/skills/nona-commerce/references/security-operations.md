# Security and operations specification

## Security baseline

- TLS only outside local development. Use Secure, HttpOnly, SameSite cookies with narrow domain/path.
- Protect cookie-authenticated writes from CSRF; use a strict CORS allowlist for cross-origin clients.
- Validate request size, content type, schema, and authorization before domain execution.
- Order lookup by code, password reset and sign-up are rate-limited per IP (in memory today; Redis before multi-replica). The web server forwards `X-Forwarded-For` so limits apply to the visitor; in production the edge proxy must set/overwrite it.
- Rate-limit login, reset, coupon validation, checkout, order lookup, uploads, and webhooks appropriately.
- Use parameterized queries. Escape output by context; sanitize only intentional rich HTML.
- Set CSP, frame restrictions, MIME-sniffing protection, referrer policy, and relevant headers.

## Secrets and privacy

- Secrets live in environment/secret management, never Git, browser bundles, logs, screenshots, or fixtures.
- Separate credentials by environment and rotate after exposure or provider/personnel changes.
- Collect only data required to sell and fulfill orders. Define retention for sessions, logs, carts, uploads, and customer data.
- Redact passwords, tokens, cookies, full addresses, payment payloads, and sensitive user data from logs.
- Provide controlled export, correction, and deletion consistent with accounting retention.

## Payment controls

- Verify callback signature and provider rules before mutation.
- Validate amount, currency, merchant, order reference, and transaction uniqueness.
- Restrict webhook method/content type and log only a redacted verification outcome.
- Reconcile pending or ambiguous transactions; never rely solely on redirects.
- Manual confirmation/refund requires permission, reason, and audit entry.

## Phase 5 controls

- Staff MFA: TOTP with replay protection; seeds encrypted with `MFA_ENCRYPTION_KEY`; `REQUIRE_STAFF_MFA=true` in production restricts sessions until enrolment. See `docs/security-review-phase5.md`.
- Production boot validation requires real payment credentials, `INTERNAL_API_TOKEN` and the MFA key, and forbids the payment simulator.
- Runbooks live in `docs/runbooks/` (backup/restore drill, payment outage, stuck queue and manual refunds).

## Admin controls

- Require MFA when production administration is enabled.
- Separate support, catalog, fulfillment, finance, and administrator roles.
- Role to permission mapping lives in `packages/contracts` (`ROLE_PERMISSIONS`) and is enforced by the API guard; the admin UI only hides controls.
- Audit login risk events, price changes, inventory adjustments, overrides, refunds, permission changes, and exports.
- Bulk operations need a preview, bounded scope, and explicit confirmation.

## Backup and recovery

- Automate encrypted database backups and object-store lifecycle/versioning where available.
- Define RPO/RTO before launch and test restores regularly.
- Maintain runbooks for restore, credential rotation, payment outage, stuck queue, inventory inconsistency, and rollback.
- Production releases need migration compatibility and rollback or roll-forward decisions.

## Launch gate

Verify HTTPS, domain/email, backup restore, payment sandbox then low-value live payment, webhook retry, order notifications, permissions, rate limits, monitoring, legal content, and support access before real orders.

- **Phone OTP:** codes are random 6 digits from a CSPRNG, stored only as a keyed hash, valid 5 minutes, limited to 5 wrong tries, single use, rate-limited per account and per number. The message goes out through the outbox (`phone.otp`): the worker sends it via Zalo ZNS (`SMS_MODE=zalo`, `ZALO_ZNS_ACCESS_TOKEN`, `ZALO_ZNS_TEMPLATE_ID`), deletes the code from the event after sending (or on dead-letter) and drops codes that expired in the queue. The simulator must not run in production (API and worker refuse to start). **Zalo tokens:** the worker keeps the OA access token valid with the OAuth refresh token (`ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_REFRESH_TOKEN`, `ZALO_TOKEN_KEY`); the rotating pair is stored AES-256-GCM encrypted in `integration_tokens` (migration 0020) under a row lock, refreshed 10 minutes before expiry and once on a -124/-216 error. Setup and troubleshooting: `docs/runbooks/zalo-otp-setup.md`.
- **Firebase Phone Auth (alternative to the SMS provider, needs no business papers):** the ID token is trusted only after the API checks its RS256 signature against Google's published keys (`FIREBASE_JWKS_URL`, cached 1 h, refreshed once per minute for an unknown key id), `iss = https://securetoken.google.com/<project>`, `aud = <project>`, expiry, `auth_time` not older than 5 minutes, `firebase.sign_in_provider = phone` and a Vietnamese mobile `phone_number`. No server secret is involved; the Firebase web config is public by design, so restrict the API key (HTTP referrers) and the authorised domains in the Firebase/Google console and set a billing budget alert. Send limits and reCAPTCHA protection are Firebase's. With Firebase on, the API queues no `phone.otp`, so the SMS simulator is tolerated in production. Runbook: `docs/runbooks/firebase-phone-auth.md`.
