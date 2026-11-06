-- New permission for bulk-destructive workflow administration (e.g.
-- DELETE /workflows, clearing stale imported data when switching n8n
-- endpoints) — see work/epics/e4-clear-workflows/. Deliberately granted
-- to NO named role except platform-admin (and legacy admin for backward
-- compat) — every other role's workflow:read is held far more broadly
-- (auditor, business-owner) and is too permissive for a delete-everything
-- action. Same "platform-admin's 003 grant doesn't retroactively pick up
-- new permission rows" situation 004_extended_permissions.sql's header
-- comment already documents — needs its own explicit grant.

INSERT INTO auth.permissions (name) VALUES
  ('workflow:manage')
ON CONFLICT (name) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name IN ('platform-admin', 'admin')
    AND p.name = 'workflow:manage'
ON CONFLICT DO NOTHING;
