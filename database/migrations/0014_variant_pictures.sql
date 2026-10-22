-- 0014_variant_pictures: a hat's colour is its own picture, not a global option.
--  * product pictures can belong to a variant (e.g. the red hat has the red picture);
--  * NONA Custom designs are made directly on that picture, so the separate "design base" columns go away;
--  * the global hat colours, ink colours and charm recolouring are removed from the custom options.
-- Rollback: re-add products.design_base_*; restore custom options from backup.
ALTER TABLE product_images
  ADD COLUMN variant_id uuid REFERENCES product_variants (id) ON DELETE SET NULL;
CREATE INDEX product_images_variant_idx ON product_images (variant_id) WHERE variant_id IS NOT NULL;

-- keep any hat picture uploaded through the old "design base" card as an ordinary product picture
INSERT INTO product_images (product_id, object_key, alt, width, height, position)
SELECT p.id, p.design_base_key, p.name, p.design_base_width, p.design_base_height,
       COALESCE((SELECT MAX(position) + 1 FROM product_images i WHERE i.product_id = p.id), 0)
  FROM products p
 WHERE p.design_base_key IS NOT NULL;

ALTER TABLE products
  DROP CONSTRAINT products_design_base_complete,
  DROP COLUMN design_base_key,
  DROP COLUMN design_base_width,
  DROP COLUMN design_base_height;

-- custom options: no colour/ink lists, charms are never recoloured
UPDATE site_settings
   SET value = (value - 'colors' - 'inks')
               || jsonb_build_object(
                    'motifs',
                    COALESCE((SELECT jsonb_agg(m - 'recolor') FROM jsonb_array_elements(value->'motifs') AS m), '[]'::jsonb)
                  ),
       version = version + 1,
       updated_at = now()
 WHERE key = 'custom';
