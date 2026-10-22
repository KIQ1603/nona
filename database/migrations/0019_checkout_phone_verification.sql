-- Phone verification before ordering: the number that receives the order must be proven with an OTP.
-- Guests prove it too (bound to their cart cookie), so one-time codes can belong to a user or a guest.
ALTER TABLE phone_otps
  ALTER COLUMN user_id DROP NOT NULL,
  ADD COLUMN guest_token_hash text,
  ADD COLUMN purpose text NOT NULL DEFAULT 'ACCOUNT',
  ADD COLUMN ip text,
  ADD CONSTRAINT phone_otps_one_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL)),
  ADD CONSTRAINT phone_otps_purpose_valid CHECK (purpose IN ('ACCOUNT', 'CHECKOUT'));
CREATE INDEX phone_otps_guest_idx ON phone_otps (guest_token_hash, created_at DESC) WHERE guest_token_hash IS NOT NULL;
CREATE INDEX phone_otps_ip_idx ON phone_otps (ip, created_at DESC) WHERE ip IS NOT NULL;

-- Numbers a buyer (account or guest browser) has proven they control. Not unique across buyers:
-- whoever can receive the code may use the number for their own order.
CREATE TABLE verified_phones (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone            text NOT NULL,
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  guest_token_hash text,
  verified_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT verified_phones_phone_format CHECK (phone ~ '^\+84[0-9]{9,10}$'),
  CONSTRAINT verified_phones_one_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL))
);
CREATE UNIQUE INDEX verified_phones_user_uq ON verified_phones (user_id, phone) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX verified_phones_guest_uq ON verified_phones (guest_token_hash, phone) WHERE guest_token_hash IS NOT NULL;
