-- Product types (Nón lá, Móc khóa, Kẹp tóc) and admin-chosen featured products.
-- A category without a parent is a TYPE; a category with a parent is a group inside that type (two levels only,
-- enforced by the admin API). Existing categories were all hats, so they become groups of "Nón lá".

ALTER TABLE categories ADD COLUMN parent_id uuid REFERENCES categories (id) ON DELETE RESTRICT;
ALTER TABLE categories ADD CONSTRAINT categories_parent_not_self CHECK (parent_id IS NULL OR parent_id <> id);
CREATE INDEX categories_parent_idx ON categories (parent_id);

ALTER TABLE products ADD COLUMN is_featured boolean NOT NULL DEFAULT false;
CREATE INDEX products_featured_idx ON products (is_featured) WHERE is_featured;

INSERT INTO categories (slug, name, description, sort_order) VALUES
  ('non-la',   'Nón lá',   'Nón lá thủ công: truyền thống, nón họa, thời trang.', 0),
  ('moc-khoa', 'Móc khóa', 'Móc khóa nón nhỏ xinh, đậm chất Việt.',               1),
  ('kep-toc',  'Kẹp tóc',  'Kẹp tóc dịu dàng trong từng chi tiết.',               2)
ON CONFLICT (slug) DO NOTHING;

UPDATE categories
   SET parent_id = (SELECT id FROM categories WHERE slug = 'non-la')
 WHERE parent_id IS NULL AND slug NOT IN ('non-la', 'moc-khoa', 'kep-toc');
