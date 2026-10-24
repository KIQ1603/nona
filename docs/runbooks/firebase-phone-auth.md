# Runbook: verify phone numbers with Firebase Phone Auth

Firebase texts a 6-digit code to the customer and checks it in the browser. The API only checks the signed
ID token Firebase returns and records the number as verified. No SMS provider, brandname or business papers
are needed on our side. It covers: sign-up by phone, password reset by phone, the account phone and the
phone proof at checkout.

## Firebase console (once)
1. Create a project, then **Authentication > Get started > Sign-in method > Phone > Enable**.
2. **Project settings > Your apps > Web** (`</>`): register an app and copy `apiKey`, `authDomain`, `projectId`, `appId`.
3. **Authentication > Settings > Authorized domains**: `localhost` plus the production web domain (e.g. the Vercel one).
4. **Authentication > Settings > SMS region policy**: allow Vietnam (`VN`).
5. **Phone > Phone numbers for testing**: add e.g. `+84 912 345 678` with code `123456`. Test numbers send no SMS and cost nothing.
6. Real SMS needs the **Blaze** (pay as you go) plan on most projects. Check the free quota and the price per SMS to Vietnam in the console, and set a **budget alert**.
7. Google Cloud console > APIs & Services > Credentials: restrict the browser API key to HTTP referrers (the web domains) and to the Identity Toolkit API.

## API configuration
```
FIREBASE_PROJECT_ID=...
FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_APP_ID=...
```
All four or none (the API refuses to boot with only some). Restart the API. The web app needs nothing: it
reads the public config from `GET /v1/auth/providers`. With Firebase on the API queues no `phone.otp`, so the
worker's `SMS_MODE` does not matter (the simulator is tolerated in production).

## Test
Sign up with a test number from step 5 and the code you set. Open **Authentication > Users** to see the
Firebase user created for each verified number (it is only a record Firebase keeps; our session is our own cookie).

## Troubleshooting (message shown to the customer / `error.code` from the SDK)
- `auth/operation-not-allowed`: Phone sign-in is off, or the region (VN) is not allowed.
- `auth/billing-not-enabled`: real SMS needs the Blaze plan. Test numbers work without it.
- `auth/unauthorized-domain`: add the domain to Authorized domains.
- `auth/too-many-requests` / `auth/quota-exceeded`: Firebase's own limits; wait or raise the quota.
- API 400 `TOKEN_INVALID`: token forged, from another project (`FIREBASE_PROJECT_ID` mismatch), older than 5 minutes, or not a phone sign-in.
- API 503 when verifying: Google's key endpoint is unreachable; retry.

## Switching back
Unset the four variables: the SMS pipeline (`SMS_MODE=zalo|esms|simulator`) is used again.
