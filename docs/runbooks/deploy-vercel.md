# Runbook: web on Vercel, API/worker/database elsewhere

Vercel only runs the **web** app (Next.js). The API (NestJS), the worker, PostgreSQL and the media store are
long-running services and must run somewhere else (Railway, a VPS, Render, Fly...). The browser only talks to the
Vercel domain: `/api/*` and `/media/*` are proxied to the API and the media store, so cookies stay first-party.

## 1. Deploy the backend first (it gives you the URLs Vercel needs)
- PostgreSQL 16 (Neon/Supabase/Railway/own). Use a **direct** connection string, not a transaction pooler's session mode.
- API + worker: Node 22, build `pnpm --filter @nona/contracts build && pnpm --filter @nona/api build`, start `node apps/api/dist/main.js`; worker `node apps/worker/dist/main.js`. Run `pnpm db:migrate` once per release.
- Media: S3-compatible bucket (Cloudflare R2, S3, MinIO) with public read on `products/`, `articles/`, `custom/` only.
- API environment (see `.env.example`): `NODE_ENV=production`, `DATABASE_URL`, `WEB_ORIGIN=https://<your-vercel-domain>`
  (exact origin, used for the CSRF/Origin check and CORS), `API_PUBLIC_URL`, `MEDIA_BASE_URL=https://<your-vercel-domain>/media`,
  S3_*, `PAYMENTS_MODE=vnpay` + VNPAY_*, `INTERNAL_API_TOKEN`, `MFA_ENCRYPTION_KEY`, `OTP_SECRET`, `SMS_MODE=zalo` + ZALO_*,
  SMTP_* for the worker, **`TRUST_PROXY_HOPS=2`** (Vercel + the host's proxy; a wrong value makes every visitor share one rate-limit bucket).
- Create the first staff account with `pnpm db:create-staff` (never ship a default password).

## 2. Vercel project
1. Push the repo to GitHub, *Add New → Project*, import it.
2. **Root Directory:** `apps/web`. Keep "Include source files outside of the Root Directory" ON (the build needs `packages/contracts`).
   `apps/web/vercel.json` already sets install and build commands.
3. **Node.js version:** 22.x. Add `ENABLE_EXPERIMENTAL_COREPACK=1` so Vercel uses the pnpm version from `packageManager`.
4. **Environment variables** (Production, set them *before* the first build: rewrites are baked in at build time):

| Name | Value |
|---|---|
| `INTERNAL_API_URL` | `https://<api-host>` (no trailing slash, no `/v1`) |
| `MEDIA_ORIGIN` | public base of the bucket, e.g. `https://<account>.r2.cloudflarestorage.com/nona-media` or your CDN |
| `SITE_URL` | `https://<your-vercel-domain or custom domain>` (canonical URLs, sitemap) |

5. Deploy. Then set `WEB_ORIGIN` on the API to the final domain (custom domain included) and restart the API.
6. VNPay: the return URL is built from `WEB_ORIGIN` (`https://<domain>/thanh-toan/ket-qua`). Register the **IPN URL** as
   `https://<api-host>/v1/webhooks/payments/vnpay` (the API host directly: it does not need to go through Vercel).
   VNPay may also ask for the API server's outgoing IP address.

## 3. Checks after the first deploy
- `/shop` lists products and images load; sign up, sign in, add to cart, place a COD order.
- Admin: `/admin/login`, create a product with a picture (uploads travel through the Vercel proxy).
- Cookies: `nona_session` is `HttpOnly; Secure; SameSite` on the Vercel domain.
- Worker log shows the order email being sent.

## 4. Known limits on Vercel
- Request bodies proxied through Vercel are limited (about 4.5 MB for functions; check the current limit for external rewrites). Admin pictures of 8 MB may fail: resize them below ~4 MB, or serve the admin from a host without this limit.
- Do not run `pnpm db:seed` against production (it creates sample data and a default admin).
- Serverless functions cannot run the worker or the payment reconciliation loop: they stay on the backend host.
