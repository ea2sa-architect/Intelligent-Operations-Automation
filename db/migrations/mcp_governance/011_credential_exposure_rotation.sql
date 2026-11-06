-- EP-101-S8/S9 — rotation tracking for MCP credential-exposure findings.
-- rotation_confirmed_at/by record a claimed remediation; they are carried
-- forward by servers.js/resources.js/tools.js/prompts.js's persist*
-- functions when the same fingerprint reappears on a later scan, so a
-- still-present finding with a stale rotation_confirmed_at is the "claimed
-- rotation didn't hold" signal — no separate status column needed.

ALTER TABLE mcp_governance.mcp_credential_exposure
  ADD COLUMN IF NOT EXISTS rotation_confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rotation_confirmed_by TEXT;
