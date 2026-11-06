-- EP-311-P0 — two new named permissions for the /ioa CLI's governed
-- capabilities: approving a workflow's controlled-execution test profile
-- (workflow:execution-approve), and persisting a release certification
-- decision (release:certify). Both are governance functions, same tier as
-- violation:resolve/waiver:grant — granted to governance-officer.
--
-- platform-admin's "all permissions" grant (003_named_roles.sql) is a
-- one-time cross join over auth.permissions as it existed when 003 ran —
-- it does not retroactively pick up rows inserted here, so both new
-- permissions need their own explicit grant, same as 004_extended_permissions.sql
-- had to do for its four additions.

INSERT INTO auth.permissions (name) VALUES
  ('workflow:execution-approve'),
  ('release:certify')
ON CONFLICT (name) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'platform-admin'
    AND p.name IN ('workflow:execution-approve', 'release:certify')
ON CONFLICT DO NOTHING;

-- admin (legacy): extend the same backward-compat grant 003/004 gave it.
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'admin'
    AND p.name IN ('workflow:execution-approve', 'release:certify')
ON CONFLICT DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'governance-officer'
    AND p.name IN ('workflow:execution-approve', 'release:certify')
ON CONFLICT DO NOTHING;
