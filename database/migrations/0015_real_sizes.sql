-- Real-world proportions for NONA Custom: the hat's width (cm) is stored per product; charm sizes (cm)
-- live in the admin-managed `custom` options (motifs[].sizeCm, imageSizeCm; defaults applied when absent).
ALTER TABLE products
  ADD COLUMN hat_width_cm numeric(5, 1),
  ADD CONSTRAINT products_hat_width_range CHECK (hat_width_cm IS NULL OR (hat_width_cm >= 5 AND hat_width_cm <= 100));
