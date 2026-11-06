-- EP-202-S1 — multi-stage approval chains, distinct from the single-actor
-- approve/deny already used everywhere else (mcp_servers.status,
-- mcp_tools.approval_status, governance.waivers). A chain is a TEMPLATE
-- (which stages, in what order, who can approve, how many of them) keyed by
-- risk_tier; a request is one in-flight instance of that template applied to
-- one asset; decisions are the individual approve/reject actions within it.
--
-- approver_role is checked against the JWT's roles claim (see
-- require-auth.js) — the same mechanism every other write-permission check
-- in this platform already uses. Not FK'd to auth.roles: today that table
-- only has 'admin'/'guest' (AUTH-502/503's fine-grained roles aren't built
-- yet — see CLAUDE.md), so this is deliberately free text now and becomes
-- more useful as named roles are added later, rather than faking a
-- constraint the platform can't actually enforce yet.
CREATE TABLE IF NOT EXISTS governance.approval_chains (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT        NOT NULL UNIQUE,
  risk_tier      TEXT        NOT NULL CHECK (risk_tier IN ('low', 'moderate', 'high', 'critical')),
  execution_mode TEXT        NOT NULL DEFAULT 'sequential' CHECK (execution_mode IN ('sequential', 'parallel')),
  -- [{ "order": 1, "approver_role": "admin", "quorum": 1 }, ...] — order is
  -- only meaningful for 'sequential' (stage N+1 opens once stage N's quorum
  -- is met); 'parallel' opens every stage at once and the chain completes
  -- once ALL stages independently reach their quorum.
  stages         JSONB       NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per asset's in-flight (or decided) run through a chain. Mirrors
-- violations'/waivers' entity_type+entity_id addressing convention.
CREATE TABLE IF NOT EXISTS governance.approval_chain_requests (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id       UUID        NOT NULL REFERENCES governance.approval_chains(id),
  asset_type     TEXT        NOT NULL,
  asset_id       TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  current_stage  INT         NOT NULL DEFAULT 1,
  requested_by   TEXT        NOT NULL,
  reason         TEXT,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_approval_chain_requests_asset ON governance.approval_chain_requests(asset_type, asset_id);
CREATE INDEX IF NOT EXISTS idx_approval_chain_requests_status ON governance.approval_chain_requests(status);

-- Append-only — an approval trail is exactly the kind of record this
-- platform never mutates after the fact elsewhere (violation_history,
-- approval_decision_history). See migration 018 for the same trigger
-- function reused here.
CREATE TABLE IF NOT EXISTS governance.approval_chain_decisions (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL REFERENCES governance.approval_chain_requests(id) ON DELETE CASCADE,
  stage_order INT         NOT NULL,
  actor       TEXT        NOT NULL,
  decision    TEXT        NOT NULL CHECK (decision IN ('approved', 'rejected')),
  reason      TEXT,
  decided_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_chain_decisions_request_id ON governance.approval_chain_decisions(request_id);

DROP TRIGGER IF EXISTS approval_chain_decisions_no_update ON governance.approval_chain_decisions;
CREATE TRIGGER approval_chain_decisions_no_update
  BEFORE UPDATE ON governance.approval_chain_decisions
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS approval_chain_decisions_no_delete ON governance.approval_chain_decisions;
CREATE TRIGGER approval_chain_decisions_no_delete
  BEFORE DELETE ON governance.approval_chain_decisions
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();
