-- EP-306-S12 — Scoped, revocable API keys for machine clients (starting with the
-- future discovery-agent CLI) that can't hold a browser session cookie. The raw key
-- is a long-lived secret the client stores; it's exchanged (POST /api-keys/exchange)
-- for a short-lived JWT that flows through the exact same requireAuth/requirePermission
-- pipeline a browser session already uses — scopes are just permission strings from
-- the existing auth.permissions catalog, not a separate vocabulary.

CREATE TABLE IF NOT EXISTS auth.api_keys (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  key_hash     TEXT        NOT NULL UNIQUE,
  key_prefix   TEXT        NOT NULL,
  scopes       TEXT[]      NOT NULL DEFAULT '{}',
  created_by   UUID        REFERENCES auth.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ
);
