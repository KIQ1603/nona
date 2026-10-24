-- Accounts can be created with a phone number instead of an email, and registration / password reset by phone
-- work with one-time codes ("challenges") that are checked BEFORE anything is created or changed.
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_has_identifier CHECK (email IS NOT NULL OR phone IS NOT NULL);
-- a phone account is looked up by its (verified) phone
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_login_uq ON users (phone) WHERE phone IS NOT NULL AND phone_verified_at IS NOT NULL;

-- orders of a phone-only account may have no email (notifications by email are then skipped)
ALTER TABLE orders ALTER COLUMN customer_email DROP NOT NULL;

CREATE TABLE auth_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose       text NOT NULL,
  channel       text NOT NULL,
  identifier    text NOT NULL,
  user_id       uuid REFERENCES users (id) ON DELETE CASCADE,
  full_name     text,
  password_hash text,
  code_hash     text NOT NULL,
  attempts      integer NOT NULL DEFAULT 0,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  ip            text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT auth_challenges_purpose_valid CHECK (purpose IN ('REGISTER', 'RESET')),
  CONSTRAINT auth_challenges_channel_valid CHECK (channel IN ('EMAIL', 'PHONE'))
);
CREATE INDEX auth_challenges_identifier_idx ON auth_challenges (identifier, created_at DESC);
CREATE INDEX auth_challenges_ip_idx ON auth_challenges (ip, created_at DESC) WHERE ip IS NOT NULL;
