-- 0003_auth_audit_settings: staff/customer accounts, server-side sessions, audit log,
-- idempotency keys and admin-managed site settings.
-- Forward: additive only. Rollback: DROP the five tables and forbid_mutation usage on audit_logs.
-- Validation: SELECT count(*) FROM information_schema.tables
--   WHERE table_name IN ('users','sessions','audit_logs','idempotency_keys','site_settings'); -- expect 5

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  password_hash text NOT NULL,
  full_name     text NOT NULL,
  role          text NOT NULL DEFAULT 'CUSTOMER',
  status        text NOT NULL DEFAULT 'ACTIVE',
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(btrim(email))),
  CONSTRAINT users_role_valid CHECK (role IN ('CUSTOMER', 'SUPPORT', 'CATALOG', 'FULFILLMENT', 'FINANCE', 'ADMIN')),
  CONSTRAINT users_status_valid CHECK (status IN ('ACTIVE', 'DISABLED'))
);
CREATE UNIQUE INDEX users_email_key ON users (email);

-- Opaque session tokens are stored only as SHA-256 hashes.
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL,
  csrf_token   text NOT NULL,
  user_agent   text,
  ip_address   text,
  expires_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessions_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX sessions_token_hash_key ON sessions (token_hash);
CREATE INDEX sessions_user_idx ON sessions (user_id, revoked_at);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users (id) ON DELETE RESTRICT,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_idx ON audit_logs (created_at DESC, id);
CREATE INDEX audit_logs_target_idx ON audit_logs (target_type, target_id);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Binds a client key to user + operation + request hash; reuse with different input is rejected.
CREATE TABLE idempotency_keys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL,
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  operation     text NOT NULL,
  request_hash  text NOT NULL,
  response_status integer,
  response_body jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT idempotency_key_length CHECK (char_length(key) BETWEEN 8 AND 128)
);
CREATE UNIQUE INDEX idempotency_keys_scope_key ON idempotency_keys (user_id, operation, key);

-- Business configuration edited by admins (announcement, shipping thresholds, ...). Never hard-coded.
CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  version    integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES
  ('announcement', '{"enabled": true, "text": "Miễn phí vận chuyển cho đơn từ 600.000đ", "linkUrl": null}'),
  ('shipping',     '{"freeShippingThresholdVnd": 600000}');
