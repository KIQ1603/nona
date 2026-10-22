-- 0012_design_base_images: optional picture of the plain hat shown in NONA Custom (transparent background).
-- When set it replaces the generic drawn hat in the designer and in stored previews.
-- Rollback: ALTER TABLE products DROP COLUMN design_base_key, DROP COLUMN design_base_width, DROP COLUMN design_base_height;
ALTER TABLE products
  ADD COLUMN design_base_key    text,
  ADD COLUMN design_base_width  integer,
  ADD COLUMN design_base_height integer,
  ADD CONSTRAINT products_design_base_complete CHECK (
    (design_base_key IS NULL AND design_base_width IS NULL AND design_base_height IS NULL)
    OR (design_base_key IS NOT NULL AND design_base_width > 0 AND design_base_height > 0)
  );
