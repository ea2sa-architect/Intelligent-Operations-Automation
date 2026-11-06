-- EP-105-S1 — full violation lifecycle state machine. Replaces the old
-- flat 'waived' status with the richer waiver workflow EP-104 introduces
-- (waiver_requested → waived_temporarily, with automatic reopening on
-- expiry — see governance.waivers in the next migration) and adds
-- 'remediating' (actively being fixed, distinct from merely 'acknowledged')
-- and 'reopened' (a resolved violation whose condition reappeared on
-- re-evaluation — see rule-evaluator.js).
--
-- No existing 'waived' rows in this environment (verified before writing
-- this migration) — a production migration with real data would need an
-- UPDATE ... SET status = 'waived_temporarily' WHERE status = 'waived'
-- before the new CHECK is added; included here defensively in case that
-- assumption is ever wrong on a later environment.

UPDATE governance.violations SET status = 'waived_temporarily' WHERE status = 'waived';

ALTER TABLE governance.violations DROP CONSTRAINT violations_status_check;
ALTER TABLE governance.violations ADD CONSTRAINT violations_status_check
  CHECK (status IN ('open', 'acknowledged', 'remediating', 'waiver_requested', 'waived_temporarily', 'resolved', 'reopened'));
