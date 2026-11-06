-- Epic 1, Feature 1.1 (AUTH-102) — dedicated auth schema, isolated from
-- governance-domain data. Deliberately minimal per AUTH-102's acceptance
-- criteria: id, username (unique), password_hash, status, created_at,
-- last_login_at. Designed to grow into Epic 5's roles/permissions without
-- redesigning this table (AUTH-501 adds separate role/permission tables
-- referencing users.id, not columns here).

CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  username       TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at  TIMESTAMPTZ
);
