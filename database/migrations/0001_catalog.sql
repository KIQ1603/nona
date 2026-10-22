-- 0001_catalog: categories, products, variants, images, inventory movements.
-- Forward: additive only. Rollback: DROP TABLE in reverse order (no production data yet).
-- Validation: SELECT count(*) FROM information_schema.tables WHERE table_name IN
--   ('categories','products','product_variants','product_images','inventory_movements'); -- expect 5

CREATE TABLE categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT categories_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
CREATE UNIQUE INDEX categories_slug_key ON categories (slug);

CREATE TABLE products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id     uuid NOT NULL REFERENCES categories (id) ON DELETE RESTRICT,
  slug            text NOT NULL,
  name            text NOT NULL,
  summary         text,
  description     text,
  status          text NOT NULL DEFAULT 'DRAFT',
  badge           text,
  color_code      text,
  style_code      text,
  sort_weight     integer NOT NULL DEFAULT 0,
  seo_title       text,
  seo_description text,
  version         integer NOT NULL DEFAULT 1,
  published_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_slug_format CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  CONSTRAINT products_status_valid CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  CONSTRAINT products_published_has_date CHECK (status <> 'PUBLISHED' OR published_at IS NOT NULL)
);
CREATE UNIQUE INDEX products_slug_key ON products (slug);
CREATE INDEX products_listing_idx ON products (status, category_id, sort_weight DESC);

CREATE TABLE product_variants (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid NOT NULL REFERENCES products (id) ON DELETE RESTRICT,
  sku                  text NOT NULL,
  name                 text NOT NULL,
  price_vnd            bigint NOT NULL,
  compare_at_price_vnd bigint,
  is_active            boolean NOT NULL DEFAULT true,
  weight_grams         integer,
  position             integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT variants_price_non_negative CHECK (price_vnd >= 0),
  CONSTRAINT variants_compare_valid CHECK (compare_at_price_vnd IS NULL OR compare_at_price_vnd > price_vnd),
  CONSTRAINT variants_weight_positive CHECK (weight_grams IS NULL OR weight_grams > 0)
);
CREATE UNIQUE INDEX product_variants_sku_key ON product_variants (sku);
CREATE INDEX product_variants_product_idx ON product_variants (product_id, is_active, position);

CREATE TABLE product_images (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  object_key text NOT NULL,
  alt        text NOT NULL,
  width      integer NOT NULL,
  height     integer NOT NULL,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_images_dimensions_positive CHECK (width > 0 AND height > 0)
);
CREATE INDEX product_images_product_idx ON product_images (product_id, position);

-- Append-only ledger. Availability = SUM(delta) (minus active reservations from Phase 4).
CREATE TABLE inventory_movements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  delta      integer NOT NULL,
  reason     text NOT NULL,
  reference  text,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_delta_non_zero CHECK (delta <> 0),
  CONSTRAINT inventory_reason_valid CHECK (reason IN ('RECEIPT', 'SALE', 'RELEASE', 'RETURN', 'ADJUSTMENT'))
);
CREATE INDEX inventory_movements_variant_idx ON inventory_movements (variant_id, created_at);

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not allowed: table is append-only', TG_OP, TG_TABLE_NAME;
END $$;

CREATE TRIGGER inventory_movements_append_only
  BEFORE UPDATE OR DELETE ON inventory_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
