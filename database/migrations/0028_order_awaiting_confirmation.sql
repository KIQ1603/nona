-- "Chờ xác nhận": a cash-on-delivery order waits for staff to confirm it by hand (they check that the phone number is
-- real) before it is prepared. AWAITING_CONFIRMATION -> CONFIRMED | CANCELLED. Online (VNPay) orders are unchanged:
-- a verified payment confirms them. Switch: checkout.requireManualConfirmation (admin Settings).
ALTER TABLE orders DROP CONSTRAINT orders_status_valid;
ALTER TABLE orders ADD CONSTRAINT orders_status_valid CHECK (status IN (
  'DRAFT', 'PENDING_PAYMENT', 'PAYMENT_FAILED', 'EXPIRED', 'PAID', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'PROCESSING',
  'READY_TO_SHIP', 'SHIPPING', 'COMPLETED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PENDING',
  'PARTIALLY_REFUNDED', 'REFUNDED'));

UPDATE site_settings
   SET value = value || '{"requireManualConfirmation": true}'::jsonb,
       version = version + 1,
       updated_at = now()
 WHERE key = 'checkout';
