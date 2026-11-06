-- Epic 6, Feature 6.2 — "configurable redaction patterns for MCP-specific
-- secrets... without changing application code" (same principle as policy
-- rule parameters being configurable without code changes). The built-in
-- SECRET_PATTERNS in credential-scanner.js stay hardcoded (they're the
-- well-known credential shapes); this table is for administrator-added
-- patterns specific to a deployment's own internal token formats.

CREATE TABLE IF NOT EXISTS mcp_governance.redaction_patterns (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  pattern    TEXT        NOT NULL,
  enabled    BOOLEAN     NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
