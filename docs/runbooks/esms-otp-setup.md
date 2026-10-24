# Runbook: send OTP codes by SMS through eSMS.vn

An alternative to Zalo ZNS (`zalo-otp-setup.md`): the worker sends the 6-digit code as an SMS.
Set `SMS_MODE=esms`. Only one mode is active at a time.

## What eSMS needs from you
1. An eSMS account with **API key and secret key** (eSMS portal → API). They are two different values.
2. A **Brandname** registered and approved by eSMS (the OTP/"customer care" API requires one) and a **message template** registered for it.
3. Credit on the account.

## Configure
```
SMS_MODE=esms
ESMS_API_KEY=...
ESMS_SECRET_KEY=...
ESMS_BRANDNAME=<your approved brandname>
ESMS_SMS_TYPE=2
ESMS_OTP_TEMPLATE=   # empty = "{code} la ma xac thuc NONA cua ban. Ma co hieu luc {minutes} phut. Khong chia se ma nay cho bat ky ai."
ESMS_SANDBOX=1       # test first: eSMS validates the request, nothing is sent or charged
```
The message text must match the template registered at eSMS (eSMS answers error 146 otherwise). Restart the API and the worker. Test with `ESMS_SANDBOX=1`, then set `0`.

## How it behaves
- The request id sent to eSMS is the outbox event id, so a retry after a network failure is recognised as a duplicate (code 124) and never sends a second SMS.
- Error 101 (authorisation failed): wrong API/secret key; retried with back-off and logged. Errors 104 (brandname unknown) and 146 (template not registered) are configuration problems: the event is dead-lettered at once and its code is deleted. Look for `eSMS error <code>` in the worker log.
- Codes, keys and phone numbers are never written to the log lines of the sender.

## Keys
Treat the keys as passwords: only in `.env` / the host's secret store, never in the repository or in chat. If they were shared anywhere, regenerate them in the eSMS portal.
