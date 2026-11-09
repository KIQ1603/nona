-- 0030_charm_scale: per-product size of charms and letters in the designer (1 = as configured, 0.5 = half, 2 = double).
-- Lets a keychain or hair clip show small charms without changing their real size in cm.
-- Rollback: ALTER TABLE products DROP COLUMN charm_scale;
ALTER TABLE products ADD COLUMN charm_scale numeric(4,2) NOT NULL DEFAULT 1
  CONSTRAINT products_charm_scale_range CHECK (charm_scale BETWEEN 0.2 AND 5);
