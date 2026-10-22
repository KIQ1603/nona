-- Existing hats: 60 cm across (diameter), 45 cm high. Only products that have no size yet are touched.
UPDATE products
   SET hat_width_cm = 60, hat_height_cm = 45
 WHERE hat_width_cm IS NULL AND hat_height_cm IS NULL;
