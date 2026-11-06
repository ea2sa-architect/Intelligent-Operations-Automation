-- Epic 5, Feature 5.1 (AUTH-501) — roles/permissions stored independently
-- from auth.users via an assignments table (auth.user_roles), exactly as
-- 001_initial.sql's header comment anticipated. A coarse read/write
-- permission model (not per-action names like approve_mcp_server) is the
-- v1 cut: it directly satisfies "guest can view everything, cannot change
-- anything" without requiring every mutating route across every service to
-- be individually re-annotated. Finer-grained named permissions (AUTH-502's
-- approval gating, AUTH-503's waiver gating) can layer on top of this
-- table shape later without another migration.

CREATE TABLE IF NOT EXISTS auth.roles (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.permissions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS auth.role_permissions (
  role_id       UUID NOT NULL REFERENCES auth.roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES auth.permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS auth.user_roles (
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id    UUID NOT NULL REFERENCES auth.roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

INSERT INTO auth.roles (name) VALUES ('admin'), ('guest')
  ON CONFLICT (name) DO NOTHING;

INSERT INTO auth.permissions (name) VALUES ('read'), ('write')
  ON CONFLICT (name) DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'admin' AND p.name IN ('read', 'write')
  ON CONFLICT DO NOTHING;

INSERT INTO auth.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM auth.roles r, auth.permissions p
  WHERE r.name = 'guest' AND p.name = 'read'
  ON CONFLICT DO NOTHING;

-- "migrations preserve existing admin access" (AUTH-501) — every user that
-- already existed before roles existed keeps full access.
INSERT INTO auth.user_roles (user_id, role_id)
  SELECT u.id, r.id FROM auth.users u, auth.roles r
  WHERE r.name = 'admin'
  ON CONFLICT DO NOTHING;
