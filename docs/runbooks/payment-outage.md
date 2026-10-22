# Runbook: payment provider outage / webhook problems

**Symptoms:** customers report "paid but order pending"; `/admin/system` shows `PAYMENT_STALE`; metric `nona_payments_stale_pending > 0`.

1. Check provider status page and our `INTERNAL_API_TOKEN`-protected metrics: `GET /v1/internal/metrics`.
2. **Do not mark orders paid by hand.** Payment is only confirmed by a verified callback or by reconciliation (the worker calls `payments-maintenance` every 30 s: it asks the provider for the real state of each payment pending > 5 minutes).
3. If callbacks are not arriving: confirm the IPN URL registered with the provider is `https://<api>/v1/webhooks/payments/vnpay`, that TLS is valid and the API is reachable. Reconciliation still settles payments without it.
4. If the provider's merchant API is down, reconciliation returns _unknown_ and changes nothing; it retries with a 2-minute back-off per payment. Orders expire when their payment window ends; a payment that succeeds later is accepted if stock is still available, otherwise it is refunded automatically.
5. If the provider is down for long: disable VNPay at checkout by switching customers to COD (communicate via the announcement bar in Admin → Settings).
6. After recovery run `POST /v1/internal/jobs/payments-maintenance` once and check `/admin/system` is clean.

**Security incident (suspected forged callbacks):** every callback is signature-checked; failures are logged as `payment callback rejected: invalid signature`. Rotate `VNPAY_HASH_SECRET` with the provider, update the secret, redeploy.
