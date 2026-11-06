-- Policy bundle import (policy-as-code). Creating policies from a file is a
-- bulk write, so it gets its own permission rather than riding on policy:edit.
-- Replacing an existing policy additionally requires policy:edit (enforced in
-- governance-service's policy-bundles route), so holding policy:import alone
-- can never change a live policy.
--
-- Granted to governance-officer (the only named role holding policy:edit),
-- platform-admin and legacy admin. Same explicit-grant situation as
-- 008/009: the 003 platform-admin cross-join does not pick up later
-- permission rows. Export reuses policy:read, which every named role has.

INSERT INTO auth.permissions (name) VALUES
  ('policy:import')
ON CONFLICT (name) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name IN ('governance-officer', 'platform-admin', 'admin')
    AND p.name = 'policy:import'
ON CONFLICT DO NOTHING;
