-- Every product offers NONA Custom unless an admin switches it off for that product.
ALTER TABLE products ALTER COLUMN is_customizable SET DEFAULT true;
UPDATE products SET is_customizable = true;
