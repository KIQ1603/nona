-- Optional real height (cm) of the hat; used for proportions when the width is not entered.
ALTER TABLE products
  ADD COLUMN hat_height_cm numeric(5, 1),
  ADD CONSTRAINT products_hat_height_range CHECK (hat_height_cm IS NULL OR (hat_height_cm >= 3 AND hat_height_cm <= 100));
