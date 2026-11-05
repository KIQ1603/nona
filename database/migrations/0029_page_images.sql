-- 0029_page_images: admin-chosen pictures of the Trang chủ and Giới thiệu pages.
-- Empty = every picture falls back to the built-in default in /public/brand.
-- Rollback: DELETE FROM site_settings WHERE key = 'pages';
INSERT INTO site_settings (key, value, version)
VALUES ('pages', '{"homeTypes": {}, "homeAbout": null, "aboutGallery": [], "aboutValues": []}'::jsonb, 1)
ON CONFLICT (key) DO NOTHING;
