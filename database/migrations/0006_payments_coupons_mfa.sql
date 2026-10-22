-- 0006_payments_coupons_mfa: online payments, refunds, admin-managed coupons, cart coupon,
-- order discounts, TOTP multi-factor auth for staff, configurable checkout window and shipping zones.
-- Forward: additive (new tables/columns with defaults). Rollback: drop the new tables/columns.
-- Validation: SELECT count(*) FROM information_schema.tables WHERE table_name IN
--   ('coupons','coupon_usages','order_discounts','payment_events','refunds','user_mfa'); -- expect 6

ALTER TABLE orders
  ADD COLUMN payment_expires_at timestamptz,
  ADD COLUMN coupon_code text;

ALTER TABLE payments
  ADD COLUMN provider_transaction_no text,
  ADD COLUMN paid_at timestamptz,
  ADD COLUMN refunded_vnd bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT payments_refund_within_amount CHECK (refunded_vnd >= 0 AND refunded_vnd <= amount_vnd);

ALTER TABLE carts ADD COLUMN coupon_code text;

CREATE TABLE coupons (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  text NOT NULL,
  description           text,
  type                  text NOT NULL,
  value                 bigint NOT NULL DEFAULT 0,
  min_order_vnd         bigint NOT NULL DEFAULT 0,
  max_discount_vnd      bigint,
  starts_at             timestamptz,
  ends_at               timestamptz,
  usage_limit_total     integer,
  usage_limit_per_user  integer,
  is_active             boolean NOT NULL DEFAULT true,
  version               integer NOT NULL DEFAULT 1,
  created_by            uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coupons_code_format CHECK (code ~ '^[A-Z0-9_-]{3,32}$'),
  CONSTRAINT coupons_type_valid CHECK (type IN ('PERCENT', 'FIXED', 'FREE_SHIPPING')),
  CONSTRAINT coupons_value_valid CHECK (
    (type = 'PERCENT' AND value BETWEEN 1 AND 100) OR (type = 'FIXED' AND value > 0) OR (type = 'FREE_SHIPPING' AND value = 0)),
  CONSTRAINT coupons_money_non_negative CHECK (min_order_vnd >= 0 AND (max_discount_vnd IS NULL OR max_discount_vnd > 0)),
  CONSTRAINT coupons_window_valid CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT coupons_limits_positive CHECK ((usage_limit_total IS NULL OR usage_limit_total > 0) AND (usage_limit_per_user IS NULL OR usage_limit_per_user > 0))
);
CREATE UNIQUE INDEX coupons_code_key ON coupons (code);

-- One row per order that used a coupon; RELEASED when the order is cancelled/expired before fulfilment.
CREATE TABLE coupon_usages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id    uuid NOT NULL REFERENCES coupons (id) ON DELETE RESTRICT,
  order_id     uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  email        text NOT NULL,
  amount_vnd   bigint NOT NULL,
  status       text NOT NULL DEFAULT 'APPLIED',
  created_at   timestamptz NOT NULL DEFAULT now(),
  released_at  timestamptz,
  CONSTRAINT coupon_usages_status_valid CHECK (status IN ('APPLIED', 'RELEASED')),
  CONSTRAINT coupon_usages_amount_non_negative CHECK (amount_vnd >= 0)
);
CREATE UNIQUE INDEX coupon_usages_order_key ON coupon_usages (order_id);
CREATE INDEX coupon_usages_coupon_idx ON coupon_usages (coupon_id, status);
CREATE INDEX coupon_usages_user_idx ON coupon_usages (coupon_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX coupon_usages_email_idx ON coupon_usages (coupon_id, email);

-- Every discount on an order records its source, amount and the rule version applied (later edits never change it).
CREATE TABLE order_discounts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  source      text NOT NULL,
  reference   text,
  label       text NOT NULL,
  applies_to  text NOT NULL DEFAULT 'GOODS',
  amount_vnd  bigint NOT NULL,
  rule        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_discounts_applies_to_valid CHECK (applies_to IN ('GOODS', 'SHIPPING')),
  CONSTRAINT order_discounts_amount_non_negative CHECK (amount_vnd >= 0)
);
CREATE INDEX order_discounts_order_idx ON order_discounts (order_id);

-- Provider events are deduplicated here: the same provider transaction is processed at most once.
CREATE TABLE payment_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    text NOT NULL,
  event_key   text NOT NULL,
  payment_id  uuid REFERENCES payments (id) ON DELETE RESTRICT,
  outcome     text NOT NULL,
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payment_events_key ON payment_events (provider, event_key);

CREATE TABLE refunds (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id       uuid NOT NULL REFERENCES payments (id) ON DELETE RESTRICT,
  order_id         uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  amount_vnd       bigint NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING',
  reason           text NOT NULL,
  provider_ref     text,
  failure_reason   text,
  -- Set once, before the provider is called. A refund that was attempted is never auto-retried (it may already have been paid).
  attempted_at     timestamptz,
  requested_by     uuid REFERENCES users (id) ON DELETE SET NULL,
  idempotency_key  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  CONSTRAINT refunds_amount_positive CHECK (amount_vnd > 0),
  CONSTRAINT refunds_status_valid CHECK (status IN ('PENDING', 'SUCCEEDED', 'FAILED'))
);
CREATE INDEX refunds_order_idx ON refunds (order_id);
CREATE UNIQUE INDEX refunds_idempotency_key ON refunds (order_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Refund records are append-only: only PENDING -> SUCCEEDED|FAILED is possible, never edits or deletes.
CREATE FUNCTION refunds_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'refunds are append-only: DELETE is not allowed';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.amount_vnd <> OLD.amount_vnd OR NEW.payment_id <> OLD.payment_id OR NEW.order_id <> OLD.order_id THEN
    RAISE EXCEPTION 'refunds are append-only: only PENDING -> SUCCEEDED/FAILED is allowed';
  END IF;
  -- while pending, the only permitted change is stamping attempted_at (once)
  IF NEW.status = 'PENDING' AND (OLD.attempted_at IS NOT NULL OR NEW.attempted_at IS NULL) THEN
    RAISE EXCEPTION 'refunds are append-only: only PENDING -> SUCCEEDED/FAILED is allowed';
  END IF;
  IF NEW.status NOT IN ('PENDING', 'SUCCEEDED', 'FAILED') THEN
    RAISE EXCEPTION 'refunds are append-only: invalid status';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_guard_trg BEFORE UPDATE OR DELETE ON refunds FOR EACH ROW EXECUTE FUNCTION refunds_guard();

-- TOTP second factor for staff. The secret is stored encrypted (AES-256-GCM, key from the environment).
CREATE TABLE user_mfa (
  user_id        uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_enc     text NOT NULL,
  enabled_at     timestamptz,
  last_used_step bigint NOT NULL DEFAULT 0,
  recovery_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sessions ADD COLUMN mfa_restricted boolean NOT NULL DEFAULT false;

-- Admin-managed configuration (never constants in code).
INSERT INTO site_settings (key, value) VALUES ('checkout', '{"paymentWindowMinutes": 30}');
UPDATE site_settings SET value = value || '{"zones": []}'::jsonb, version = version + 1 WHERE key = 'shipping';
