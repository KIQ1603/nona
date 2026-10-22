# Runbook: send OTP codes through Zalo (ZNS)

Goal: customers receive the 6-digit code as a Zalo message from the shop's Official Account (OA).

## 1. What you need
1. A **Zalo Official Account** (oa.zalo.me), verified, with the **ZNS** service enabled and a funded balance (ZNS is paid per message).
2. A **Zalo application** (developers.zalo.me) linked to that OA.
3. An **approved ZNS template** of type "Mã xác thực (OTP)".

## 2. Steps
1. **OA**: create/verify the OA, then open the ZNS portal (zns.oa.zalo.me) and register the service. Top up the balance.
2. **App**: on developers.zalo.me create an app. Note the **App ID** and **Secret key**. Under *Official Account → Cài đặt*, set the **Callback URL** (any HTTPS page you control, e.g. `https://nona.vn/zalo/callback`; it only has to receive the redirect, you copy `code` from the address bar) and link the OA. Enable the ZNS permissions.
3. **Template**: in the ZNS portal create a template of type *OTP*, with one parameter (default name `otp`). Wait for approval (hours to a day), then copy the **Template ID**. While waiting, use `ZALO_ZNS_MODE=development` to send test messages.
4. **Authorise the app** (once):
   ```bash
   export ZALO_APP_ID=... ZALO_APP_SECRET=... ZALO_REDIRECT_URI=https://nona.vn/zalo/callback
   node scripts/zalo-oauth.mjs url                # open the link as OA admin, press "Cho phép"
   node scripts/zalo-oauth.mjs exchange <code>    # code from the redirect address bar
   ```
   It prints `ZALO_OA_REFRESH_TOKEN`. The refresh token lasts about 3 months and is single use; the worker rotates it on every refresh and keeps the latest pair encrypted in the `integration_tokens` table, so you only do this once (and again only if the OA is de-authorised or the worker was offline for months).
5. **Configure** `.env` (worker and API read the same file):
   ```
   SMS_MODE=zalo
   OTP_SECRET=<random, >= 24 chars>
   ZALO_APP_ID=...   ZALO_APP_SECRET=...
   ZALO_OA_REFRESH_TOKEN=...
   ZALO_TOKEN_KEY=<openssl rand -base64 32>
   ZALO_ZNS_TEMPLATE_ID=...
   ZALO_ZNS_CODE_PARAM=otp        # the parameter name in your template
   ```
6. **Restart** the API and the worker (`SMS_MODE` is read at start). In production the simulator is refused.
7. **Test**: sign in, Profile → Số điện thoại → send the code to a number that uses Zalo. Watch the worker log (`outbox` jobs; failures retry with back-off and show `Zalo ZNS error <code>`).

## 3. Troubleshooting
| Symptom | Likely cause |
|---|---|
| `Zalo token refresh failed` | refresh token wrong/used twice/OA de-authorised: run step 4 again, delete the row `DELETE FROM integration_tokens WHERE provider='zalo'` and restart the worker. |
| `Zalo ZNS error -118` (and similar) | the number has no Zalo account / cannot receive ZNS; the event is dead-lettered at once (customer should use another number). |
| `-124` / `-216` | access token invalid; the worker refreshes and retries once automatically. |
| Template/parameter errors | check `ZALO_ZNS_TEMPLATE_ID`, `ZALO_ZNS_CODE_PARAM` and that the template is approved. |
| No message, no error | worker not running, or `SMS_MODE=simulator` (the code is only logged). |

Security: never commit `.env`; `ZALO_APP_SECRET`, `ZALO_OA_REFRESH_TOKEN` and `ZALO_TOKEN_KEY` are secrets. Codes are never stored or logged after they are sent.
