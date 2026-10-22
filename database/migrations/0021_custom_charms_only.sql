-- NONA Custom only offers the shop's charms: no customer text or pictures, no approval step.
-- (These options are no longer shown in the admin; the values stay in the settings row for the backend.)
UPDATE site_settings
   SET value = value || '{"allowText": false, "allowImage": false, "requireApproval": false}'::jsonb,
       version = version + 1,
       updated_at = now()
 WHERE key = 'custom';
