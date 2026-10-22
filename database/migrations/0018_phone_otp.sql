-- Phone verification by one-time code (OTP) sent through Zalo ZNS.
-- users.phone is always stored in E.164 form (+84...). A number can be verified by one account only.
ALTER TABLE users
  ADD COLUMN phone text,
  ADD COLUMN phone_verified_at timestamptz,
  ADD CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^\+84[0-9]{9,10}$'),
  ADD CONSTRAINT users_phone_verified_has_phone CHECK (phone_verified_at IS NULL OR phone IS NOT NULL);
CREATE UNIQUE INDEX users_phone_verified_uq ON users (phone) WHERE phone_verified_at IS NOT NULL;

-- Only a keyed hash of the code is stored; rows are short-lived (cleanup job removes old ones).
CREATE TABLE phone_otps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  phone       text NOT NULL,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT phone_otps_phone_format CHECK (phone ~ '^\+84[0-9]{9,10}$')
);
CREATE INDEX phone_otps_user_idx ON phone_otps (user_id, created_at DESC);
CREATE INDEX phone_otps_phone_idx ON phone_otps (phone, created_at DESC);
