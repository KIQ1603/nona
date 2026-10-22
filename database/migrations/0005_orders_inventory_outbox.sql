-- 0005_orders_inventory_outbox: orders and snapshots, status history, payments, shipments,
-- stock reservations, transactional outbox, password reset tokens, guest-capable idempotency.
-- Forward: additive; the only change to an existing table relaxes idempotency_keys.user_id
-- (the old unique index is replaced by one that also covers guest scopes).
-- Rollback: DROP the new tables; restore idempotency_keys.user_id NOT NULL after deleting guest rows.
-- Validation: SELECT count(*) FROM information_schema.tables WHERE table_name IN
--   ('orders','order_items','order_status_history','payments','shipments','inventory_reservations',
--    'outbox_events','password_reset_tokens'); -- expect 8

CREATE TABLE orders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_code      text NOT NULL,
  user_id          uuid REFERENCES users (id) ON DELETE RESTRICT,
  customer_email   text NOT NULL,
  status           text NOT NULL,
  payment_method   text NOT NULL,
  currency         text NOT NULL DEFAULT 'VND',
  subtotal_vnd     bigint NOT NULL,
  discount_vnd     bigint NOT NULL DEFAULT 0,
  shipping_fee_vnd bigint NOT NULL,
  total_vnd        bigint NOT NULL,
  shipping_address jsonb NOT NULL,
  customer_note    text,
  version          integer NOT NULL DEFAULT 1,
  placed_at        timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT orders_code_format CHECK (public_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),
  CONSTRAINT orders_status_valid CHECK (status IN (
    'DRAFT', 'PENDING_PAYMENT', 'PAYMENT_FAILED', 'EXPIRED', 'PAID', 'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP',
    'SHIPPING', 'COMPLETED', 'CANCELLATION_REQUESTED', 'CANCELLED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')),
  CONSTRAINT orders_payment_method_valid CHECK (payment_method IN ('COD', 'VNPAY')),
  CONSTRAINT orders_money_non_negative CHECK (subtotal_vnd >= 0 AND discount_vnd >= 0 AND shipping_fee_vnd >= 0 AND total_vnd >= 0),
  CONSTRAINT orders_total_consistent CHECK (total_vnd = subtotal_vnd - discount_vnd + shipping_fee_vnd)
);
CREATE UNIQUE INDEX orders_public_code_key ON orders (public_code);
CREATE INDEX orders_user_idx ON orders (user_id, created_at DESC);
CREATE INDEX orders_status_idx ON orders (status, created_at DESC);
CREATE INDEX orders_email_idx ON orders (customer_email);

-- Immutable commercial snapshot of what was bought.
CREATE TABLE order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  variant_id        uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  product_slug      text NOT NULL,
  product_name      text NOT NULL,
  variant_name      text NOT NULL,
  sku               text NOT NULL,
  unit_price_vnd    bigint NOT NULL,
  quantity          integer NOT NULL,
  discount_vnd      bigint NOT NULL DEFAULT 0,
  line_total_vnd    bigint NOT NULL,
  image_key         text,
  customization     jsonb,
  design_version_id uuid,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT order_items_money_non_negative CHECK (unit_price_vnd >= 0 AND discount_vnd >= 0 AND line_total_vnd >= 0),
  CONSTRAINT order_items_total_consistent CHECK (line_total_vnd = unit_price_vnd * quantity - discount_vnd)
);
CREATE INDEX order_items_order_idx ON order_items (order_id);
CREATE INDEX order_items_variant_idx ON order_items (variant_id);

CREATE TABLE order_status_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Strict insertion order: several transitions can happen in one transaction and share created_at.
  seq         bigint GENERATED ALWAYS AS IDENTITY,
  order_id    uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  from_status text,
  to_status   text NOT NULL,
  actor_type  text NOT NULL,
  actor_id    uuid REFERENCES users (id) ON DELETE RESTRICT,
  reason      text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT order_history_actor_valid CHECK (actor_type IN ('CUSTOMER', 'GUEST', 'ADMIN', 'SYSTEM'))
);
CREATE INDEX order_status_history_order_idx ON order_status_history (order_id, created_at);
CREATE TRIGGER order_status_history_append_only
  BEFORE UPDATE OR DELETE ON order_status_history
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  provider        text NOT NULL,
  amount_vnd      bigint NOT NULL,
  status          text NOT NULL,
  provider_ref    text,
  idempotency_key text,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payments_amount_non_negative CHECK (amount_vnd >= 0),
  CONSTRAINT payments_provider_valid CHECK (provider IN ('COD', 'VNPAY')),
  CONSTRAINT payments_status_valid CHECK (status IN ('PENDING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'))
);
CREATE INDEX payments_order_idx ON payments (order_id);
CREATE UNIQUE INDEX payments_provider_ref_key ON payments (provider, provider_ref) WHERE provider_ref IS NOT NULL;

CREATE TABLE shipments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES orders (id) ON DELETE RESTRICT,
  carrier       text NOT NULL,
  tracking_code text,
  status        text NOT NULL DEFAULT 'SHIPPED',
  shipped_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT shipments_status_valid CHECK (status IN ('SHIPPED', 'DELIVERED', 'RETURNED'))
);
CREATE INDEX shipments_order_idx ON shipments (order_id);

-- Quantity held for an order. ACTIVE reservations (not yet expired) reduce availability.
CREATE TABLE inventory_reservations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id  uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  order_id    uuid REFERENCES orders (id) ON DELETE RESTRICT,
  quantity    integer NOT NULL,
  status      text NOT NULL DEFAULT 'ACTIVE',
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT reservations_quantity_positive CHECK (quantity > 0),
  CONSTRAINT reservations_status_valid CHECK (status IN ('ACTIVE', 'CONSUMED', 'RELEASED', 'EXPIRED')),
  CONSTRAINT reservations_expiry_after_creation CHECK (expires_at > created_at)
);
CREATE INDEX reservations_variant_idx ON inventory_reservations (variant_id, status, expires_at);
CREATE INDEX reservations_order_idx ON inventory_reservations (order_id);

CREATE TABLE outbox_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type            text NOT NULL,
  payload         jsonb NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING',
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  CONSTRAINT outbox_status_valid CHECK (status IN ('PENDING', 'SENT', 'DEAD'))
);
CREATE INDEX outbox_due_idx ON outbox_events (next_attempt_at) WHERE status = 'PENDING';

CREATE TABLE password_reset_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX password_reset_token_hash_key ON password_reset_tokens (token_hash);
CREATE INDEX password_reset_user_idx ON password_reset_tokens (user_id);

-- Guests place orders too: scope idempotency keys by user OR an opaque guest scope.
ALTER TABLE idempotency_keys ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE idempotency_keys ADD COLUMN scope text;
ALTER TABLE idempotency_keys ADD CONSTRAINT idempotency_owner_present CHECK (user_id IS NOT NULL OR scope IS NOT NULL);
DROP INDEX idempotency_keys_scope_key;
CREATE UNIQUE INDEX idempotency_keys_owner_key ON idempotency_keys ((COALESCE(user_id::text, scope)), operation, key);

-- Shipping fee is admin-configured, never a constant in code.
UPDATE site_settings SET value = value || '{"flatFeeVnd": 30000}'::jsonb, version = version + 1 WHERE key = 'shipping';
