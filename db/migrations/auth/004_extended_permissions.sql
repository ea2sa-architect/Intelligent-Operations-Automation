-- EP-308-S4 — Named permissions for the four services 003_named_roles.sql
-- didn't cover: escalation-service, ai-inference-service, telemetry-service,
-- and audit-service have no domain permission in the original 10-item
-- catalog, so their mutating routes could only fall back to the coarse
-- read/write check in require-auth.js. Extending the catalog rather than
-- reusing an unrelated permission (e.g. audit:read gating a write) keeps
-- each grant legible in the role table.
--
-- incident:manage and inference:manage are human-facing (governance-officer
-- triages incidents and reviews AI model/inference decisions through the
-- SPA). telemetry:write and audit:write are not granted to any named role —
-- both routes are service-to-service ingestion (telemetry-service/metrics,
-- audit-service/events) that already authenticate via INTERNAL_SERVICE_KEY
-- and bypass requirePermission entirely (see requirePermission's isService
-- check in require-auth.js); the permissions exist so requirePermission has
-- something to check when a route is hit without that header, not because a
-- human role is expected to hold them. platform-admin gets both anyway via
-- its blanket "all permissions" grant, for manual/support use.

INSERT INTO auth.permissions (name) VALUES
  ('incident:manage'),
  ('inference:manage'),
  ('telemetry:write'),
  ('audit:write')
ON CONFLICT (name) DO NOTHING;

-- platform-admin: 003_named_roles.sql's "all permissions" grant was a cross
-- join over auth.permissions as it existed when 003 ran — it does not
-- retroactively pick up rows inserted here, so the new permissions need
-- their own explicit grant.
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'platform-admin'
    AND p.name IN ('incident:manage', 'inference:manage', 'telemetry:write', 'audit:write')
ON CONFLICT DO NOTHING;

-- admin (legacy): extend the same backward-compat grant 003 gave it.
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'admin'
    AND p.name IN ('incident:manage', 'inference:manage', 'telemetry:write', 'audit:write')
ON CONFLICT DO NOTHING;

-- governance-officer: incident response and AI model/inference oversight
-- are governance functions, same tier as violation:resolve/waiver:grant.
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'governance-officer'
    AND p.name IN ('incident:manage', 'inference:manage')
ON CONFLICT DO NOTHING;
