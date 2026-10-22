-- 0009_contact_settings: admin-managed contact channels (floating chat buttons + contact page).
-- Rollback: DELETE FROM site_settings WHERE key = 'contact';
INSERT INTO site_settings (key, value, version)
VALUES ('contact', '{"floatingEnabled": true, "headline": "Liên hệ NONA", "description": "", "address": "", "hours": "", "channels": []}', 1)
ON CONFLICT (key) DO NOTHING;
