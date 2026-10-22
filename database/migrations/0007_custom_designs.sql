-- 0007_custom_designs: NONA Custom - designs, immutable versions, layers, moderated uploads, and the
-- hooks that let a design version travel through cart and order.
-- Forward: additive, plus a replacement of the cart_items uniqueness (same SKU may now appear once per design).
-- Rollback: drop the new tables/columns and restore the old cart_items index (only valid while no design items exist).
-- Validation: SELECT count(*) FROM information_schema.tables WHERE table_name IN
--   ('design_assets','custom_designs','custom_design_versions','design_layers'); -- expect 4

ALTER TABLE products ADD COLUMN is_customizable boolean NOT NULL DEFAULT false;

-- Customer uploads. Private objects (never publicly listed); moderated by staff before a design can use them.
CREATE TABLE design_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  guest_token_hash text,
  object_key       text NOT NULL,
  width            integer NOT NULL,
  height           integer NOT NULL,
  status           text NOT NULL DEFAULT 'PENDING',
  review_note      text,
  reviewed_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_assets_single_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL)),
  CONSTRAINT design_assets_status_valid CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  CONSTRAINT design_assets_dimensions_positive CHECK (width > 0 AND height > 0)
);
CREATE INDEX design_assets_user_idx ON design_assets (user_id);
CREATE INDEX design_assets_guest_idx ON design_assets (guest_token_hash);

-- A design belongs to one account, or to an unguessable guest token (stored hashed).
CREATE TABLE custom_designs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES users (id) ON DELETE CASCADE,
  guest_token_hash text,
  contact_email    text,
  title            text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT custom_designs_single_owner CHECK ((user_id IS NOT NULL) <> (guest_token_hash IS NOT NULL))
);
CREATE INDEX custom_designs_user_idx ON custom_designs (user_id, updated_at DESC);
CREATE INDEX custom_designs_guest_idx ON custom_designs (guest_token_hash, updated_at DESC);

CREATE TABLE custom_design_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  design_id          uuid NOT NULL REFERENCES custom_designs (id) ON DELETE RESTRICT,
  version_no         integer NOT NULL,
  variant_id         uuid NOT NULL REFERENCES product_variants (id) ON DELETE RESTRICT,
  hat_color_id       text NOT NULL,
  status             text NOT NULL DEFAULT 'DRAFT',
  -- Frozen when the version is submitted: what the customisation adds on top of the base variant price.
  price_addition_vnd bigint NOT NULL DEFAULT 0,
  preview_key        text,
  submitted_at       timestamptz,
  reviewed_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at        timestamptz,
  review_note        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT design_versions_status_valid CHECK (status IN ('DRAFT', 'SUBMITTED', 'APPROVED', 'REVISION_REQUIRED', 'ARCHIVED')),
  CONSTRAINT design_versions_price_non_negative CHECK (price_addition_vnd >= 0),
  CONSTRAINT design_versions_submitted_has_preview CHECK (status = 'DRAFT' OR (preview_key IS NOT NULL AND submitted_at IS NOT NULL))
);
CREATE UNIQUE INDEX design_versions_number_key ON custom_design_versions (design_id, version_no);
CREATE INDEX design_versions_status_idx ON custom_design_versions (status, submitted_at);

CREATE TABLE design_layers (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES custom_design_versions (id) ON DELETE CASCADE,
  position   integer NOT NULL,
  kind       text NOT NULL,
  props      jsonb NOT NULL DEFAULT '{}'::jsonb,
  asset_id   uuid REFERENCES design_assets (id) ON DELETE RESTRICT,
  x          numeric(6, 4) NOT NULL DEFAULT 0.5,
  y          numeric(6, 4) NOT NULL DEFAULT 0.5,
  scale      numeric(6, 3) NOT NULL DEFAULT 1,
  rotation   numeric(6, 2) NOT NULL DEFAULT 0,
  CONSTRAINT design_layers_kind_valid CHECK (kind IN ('TEXT', 'MOTIF', 'IMAGE')),
  CONSTRAINT design_layers_image_has_asset CHECK ((kind = 'IMAGE') = (asset_id IS NOT NULL)),
  CONSTRAINT design_layers_ranges CHECK (x BETWEEN 0 AND 1 AND y BETWEEN 0 AND 1 AND scale BETWEEN 0.1 AND 5 AND rotation BETWEEN -180 AND 180)
);
CREATE UNIQUE INDEX design_layers_position_key ON design_layers (version_id, position);

-- Immutability. Only a DRAFT may change. After submission the content is frozen and only review
-- transitions are possible: SUBMITTED -> APPROVED | REVISION_REQUIRED, and APPROVED | REVISION_REQUIRED -> ARCHIVED.
CREATE FUNCTION design_version_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN RAISE EXCEPTION 'design versions are immutable once submitted: DELETE is not allowed'; END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    IF NEW.status NOT IN ('DRAFT', 'SUBMITTED') THEN RAISE EXCEPTION 'design versions are immutable: a draft can only be submitted'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.design_id <> OLD.design_id OR NEW.version_no <> OLD.version_no OR NEW.variant_id <> OLD.variant_id
     OR NEW.hat_color_id <> OLD.hat_color_id OR NEW.price_addition_vnd <> OLD.price_addition_vnd
     OR NEW.preview_key IS DISTINCT FROM OLD.preview_key OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
    RAISE EXCEPTION 'design versions are immutable once submitted';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'SUBMITTED' AND NEW.status IN ('APPROVED', 'REVISION_REQUIRED'))
    OR (OLD.status IN ('APPROVED', 'REVISION_REQUIRED') AND NEW.status = 'ARCHIVED')) THEN
    RAISE EXCEPTION 'design versions are immutable: invalid status transition % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER design_versions_guard BEFORE UPDATE OR DELETE ON custom_design_versions FOR EACH ROW EXECUTE FUNCTION design_version_guard();

CREATE FUNCTION design_layer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM custom_design_versions WHERE id = COALESCE(NEW.version_id, OLD.version_id);
  IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'design layers are immutable once the version is submitted';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER design_layers_guard BEFORE INSERT OR UPDATE OR DELETE ON design_layers FOR EACH ROW EXECUTE FUNCTION design_layer_guard();

-- Cart / order hooks. The same variant may appear once per design version.
ALTER TABLE cart_items ADD COLUMN design_version_id uuid REFERENCES custom_design_versions (id) ON DELETE RESTRICT;
DROP INDEX cart_items_cart_variant_key;
CREATE UNIQUE INDEX cart_items_cart_variant_design_key
  ON cart_items (cart_id, variant_id, COALESCE(design_version_id, '00000000-0000-0000-0000-000000000000'::uuid));
ALTER TABLE order_items ADD CONSTRAINT order_items_design_version_fk
  FOREIGN KEY (design_version_id) REFERENCES custom_design_versions (id) ON DELETE RESTRICT;
CREATE INDEX order_items_design_idx ON order_items (design_version_id) WHERE design_version_id IS NOT NULL;

-- Admin-managed options (see site_settings 'custom'). The values below are SAMPLE data to be edited in Admin.
INSERT INTO site_settings (key, value) VALUES ('custom', $json${
  "enabled": true,
  "requireApproval": true,
  "maxLayers": 6,
  "maxTextLength": 30,
  "textPriceVnd": 30000,
  "imagePriceVnd": 60000,
  "colors": [
    {"id": "natural", "name": "Tự nhiên", "hex": "#d5bd84", "priceVnd": 0},
    {"id": "red", "name": "Đỏ son", "hex": "#a93d31", "priceVnd": 20000},
    {"id": "blue", "name": "Xanh lam", "hex": "#466579", "priceVnd": 20000},
    {"id": "pink", "name": "Hồng", "hex": "#dba7a2", "priceVnd": 20000},
    {"id": "black", "name": "Đen", "hex": "#353533", "priceVnd": 30000}
  ],
  "inks": [
    {"id": "ivory", "name": "Trắng ngà", "hex": "#f5f0e5"},
    {"id": "red", "name": "Đỏ son", "hex": "#a83b2e"},
    {"id": "green", "name": "Xanh rêu", "hex": "#21352d"},
    {"id": "gold", "name": "Vàng đồng", "hex": "#c49b50"},
    {"id": "black", "name": "Đen", "hex": "#242a27"}
  ],
  "motifs": [
    {"id": "lotus", "name": "Hoa sen", "path": "M50 12 C63 33 63 55 50 76 C37 55 37 33 50 12 Z M50 78 C30 73 14 58 10 38 C27 42 42 56 50 78 Z M50 78 C70 73 86 58 90 38 C73 42 58 56 50 78 Z", "priceVnd": 25000},
    {"id": "wave", "name": "Sóng", "path": "M4 52 Q19 22 34 52 T64 52 T94 52 L94 68 Q79 38 64 68 T34 68 T4 68 Z", "priceVnd": 25000},
    {"id": "star", "name": "Ngôi sao", "path": "M50 8 L61 38 L93 38 L67 57 L77 88 L50 69 L23 88 L33 57 L7 38 L39 38 Z", "priceVnd": 20000},
    {"id": "sun", "name": "Mặt trời", "path": "M50 20 A30 30 0 1 1 49.9 20 Z", "priceVnd": 20000}
  ]
}$json$::jsonb);
