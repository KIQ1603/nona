-- Phone verification (OTP) before ordering is switched off for now: customers only have to give a valid
-- Vietnamese mobile number (checked by format). The OTP flow and the admin switch stay: turn it back on in
-- Settings > Đặt hàng và thanh toán (`checkout.requirePhoneVerification`).
UPDATE site_settings
   SET value = value || '{"requirePhoneVerification": false}'::jsonb,
       version = version + 1,
       updated_at = now()
 WHERE key = 'checkout';
