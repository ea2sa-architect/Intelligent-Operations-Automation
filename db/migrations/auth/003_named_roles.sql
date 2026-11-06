-- EP-308-S1 — Five named enterprise roles replacing the coarse admin/guest model.
-- The existing admin and guest roles (from 002_roles.sql) are kept intact for
-- backward compatibility; existing admin users retain full access automatically
-- because admin gets every named permission below.
--
-- Permission design: action-scoped names (mcp:approve) rather than resource CRUD
-- (mcp_server:write) so individual actions can be granted independently.
-- A governance-officer can approve MCP servers but not manage users; a
-- security-reviewer can register (submit) but not approve.

-- ── Named permissions ────────────────────────────────────────────────────────
INSERT INTO auth.permissions (name) VALUES
  ('mcp:read'),
  ('mcp:register'),
  ('mcp:approve'),
  ('policy:read'),
  ('policy:edit'),
  ('violation:resolve'),
  ('waiver:grant'),
  ('audit:read'),
  ('workflow:read'),
  ('user:manage')
ON CONFLICT (name) DO NOTHING;

-- ── Five enterprise roles ────────────────────────────────────────────────────
INSERT INTO auth.roles (name) VALUES
  ('platform-admin'),
  ('governance-officer'),
  ('security-reviewer'),
  ('business-owner'),
  ('auditor')
ON CONFLICT (name) DO NOTHING;

-- ── platform-admin: all permissions ─────────────────────────────────────────
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'platform-admin'
ON CONFLICT DO NOTHING;

-- ── admin (legacy): also gets all named permissions for backward compat ──────
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'admin'
    AND p.name IN (
      'mcp:read','mcp:register','mcp:approve',
      'policy:read','policy:edit',
      'violation:resolve','waiver:grant',
      'audit:read','workflow:read','user:manage'
    )
ON CONFLICT DO NOTHING;

-- ── governance-officer: approve/register MCP, edit policies, resolve + waiver ─
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'governance-officer'
    AND p.name IN (
      'mcp:read','mcp:register','mcp:approve',
      'policy:read','policy:edit',
      'violation:resolve','waiver:grant',
      'audit:read','workflow:read'
    )
ON CONFLICT DO NOTHING;

-- ── security-reviewer: read all + register (submit), cannot approve ──────────
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'security-reviewer'
    AND p.name IN (
      'mcp:read','mcp:register',
      'policy:read',
      'audit:read','workflow:read'
    )
ON CONFLICT DO NOTHING;

-- ── business-owner: read own team scope + submit registrations ───────────────
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'business-owner'
    AND p.name IN (
      'mcp:read','mcp:register',
      'policy:read','workflow:read'
    )
ON CONFLICT DO NOTHING;

-- ── auditor: full read-only across all domains ───────────────────────────────
INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'auditor'
    AND p.name IN (
      'mcp:read','policy:read','audit:read','workflow:read'
    )
ON CONFLICT DO NOTHING;
