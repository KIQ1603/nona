# Runbook: stuck email queue and refunds that need a human

## Email queue (outbox)

- Alert `OUTBOX_STUCK` / `OUTBOX_DEAD` (admin → Hệ thống, worker log with `alert:true`, metric `nona_outbox_*`).
- Stuck = worker stopped or SMTP down. Start the worker / fix SMTP; events are retried with exponential backoff (30 s … 1 h) and are not lost.
- Dead = failed 6 times. Fix the cause (bad SMTP credentials, missing recipient), then requeue: `UPDATE outbox_events SET status='PENDING', attempts=0, next_attempt_at=now() WHERE status='DEAD' AND id=…;` (audit this action in the incident notes). Delivery is at-least-once: a rare duplicate email is possible.

## Refunds with unknown outcome (`REFUND_NEEDS_MANUAL`)

A refund is sent to the provider **at most once**. If the call timed out or the response signature was invalid we do not know whether money moved, so the system never retries it.

1. Open the order in Admin → Orders. The refund shows "Chờ xác nhận".
2. Look the transaction up in the VNPay merchant portal.
3. Refunded there → **Đã hoàn (đối chiếu)** with a note. Not refunded → issue it in the portal or mark **Thất bại** and create a new refund request. Both actions are audited.
