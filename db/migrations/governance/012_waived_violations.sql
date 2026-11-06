-- Epic 4, Feature 4.1 — "resolve, waive, or reopen MCP violations". Adds a
-- distinct 'waived' status (accepting the risk without fixing it — a
-- different decision than 'resolved', which implies the underlying issue
-- was actually fixed) and a resolution_reason column so waiving requires
-- a recorded justification.

ALTER TABLE governance.violations DROP CONSTRAINT IF EXISTS violations_status_check;
ALTER TABLE governance.violations ADD CONSTRAINT violations_status_check
  CHECK (status IN ('open', 'acknowledged', 'resolved', 'waived'));

ALTER TABLE governance.violations
  ADD COLUMN IF NOT EXISTS resolution_reason TEXT;
