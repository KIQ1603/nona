-- 0013_designs_auto_approve: NONA Custom designs no longer wait for staff approval by default.
-- A customer's design goes straight into their order; staff only handle the normal order statuses.
-- (Admins can still switch approval back on in Admin -> Tùy chọn NONA Custom.)
-- Production-data path: flips the stored option once, clears the existing review queue, and approves the
-- pictures customers uploaded with those designs. Rollback: set custom.requireApproval back to true.
UPDATE site_settings
   SET value = jsonb_set(value, '{requireApproval}', 'false'::jsonb), version = version + 1, updated_at = now()
 WHERE key = 'custom' AND (value->>'requireApproval')::boolean IS TRUE;

UPDATE custom_design_versions
   SET status = 'APPROVED', reviewed_at = now(), review_note = 'Tự động duyệt theo cấu hình cửa hàng', updated_at = now()
 WHERE status = 'SUBMITTED';

UPDATE design_assets SET status = 'APPROVED', reviewed_at = now() WHERE status = 'PENDING';
