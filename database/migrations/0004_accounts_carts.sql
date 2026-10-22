-- 0004_accounts_carts: customer addresses, server carts (guest + user), wishlist.
-- Forward: additive only. Rollback: DROP TABLE wishlist_items, cart_items, carts, addresses.
-- Validation: SELECT count(*) FROM information_schema.tables
--   WHERE table_name IN ('addresses','carts','cart_items','wishlist_items'); -- expect 4

CREATE TABLE addresses (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  full_name  text NOT NULL,
  phone      text NOT NULL,
  line1      text NOT NULL,
  ward       text NOT NULL,
  district   text NOT NULL,
  province   text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT addresses_phone_format CHECK (phone ~ '^(\+84|0)[0-9]{9,10}$')
);
CREATE INDEX addresses_user_idx ON addresses (user_id);
CREATE UNIQUE INDEX addresses_one_default_per_user ON addresses (user_id) WHERE is_default;

-- A cart belongs to exactly one owner: a user, or an anonymous browser (token stored only as a hash).
CREATE TABLE carts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  guest_token_hash text,
  status           text NOT NULL DEFAULT 'ACTIVE',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT carts_status_valid CHECK (status IN ('ACTIVE', 'MERGED', 'CONVERTED')),
  CONSTRAINT carts_single_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL))
);
CREATE UNIQUE INDEX carts_active_user_key ON carts (user_id) WHERE status = 'ACTIVE' AND user_id IS NOT NULL;
CREATE UNIQUE INDEX carts_guest_token_key ON carts (guest_token_hash) WHERE guest_token_hash IS NOT NULL;
CREATE INDEX carts_stale_guest_idx ON carts (updated_at) WHERE guest_token_hash IS NOT NULL;

CREATE TABLE cart_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cart_id         uuid NOT NULL REFERENCES carts (id) ON DELETE CASCADE,
  variant_id      uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  quantity        integer NOT NULL,
  -- Price the shopper last saw; a difference from the live price is surfaced until acknowledged.
  seen_price_vnd  bigint NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0),
  CONSTRAINT cart_items_price_non_negative CHECK (seen_price_vnd >= 0)
);
-- Phase 6 widens this to (cart_id, variant_id, design_version_id) for customised items.
CREATE UNIQUE INDEX cart_items_cart_variant_key ON cart_items (cart_id, variant_id);

CREATE TABLE wishlist_items (
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);
