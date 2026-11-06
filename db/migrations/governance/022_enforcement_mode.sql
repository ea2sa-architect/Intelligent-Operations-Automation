-- EP-201-S1 — a policy's enforcement_mode controls what evaluateWorkflow/
-- evaluateMcpServer's rule-evaluation results actually DO at a request
-- boundary, independent of the policy's draft/active/inactive/archived
-- lifecycle (status). 'observe' is the default: a brand-new or newly
-- reactivated policy must never silently start blocking traffic — an
-- operator opts into warn/enforce deliberately, after reviewing what
-- observe mode would have decided (see governance.enforcement_events).
ALTER TABLE governance.policies
  ADD COLUMN IF NOT EXISTS enforcement_mode TEXT NOT NULL DEFAULT 'observe'
    CHECK (enforcement_mode IN ('observe', 'warn', 'enforce'));
