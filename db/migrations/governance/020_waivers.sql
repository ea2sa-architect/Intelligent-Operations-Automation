-- EP-104-S1 — formal exception workflow. A waiver is requested against an
-- open/acknowledged/remediating violation, requires an approver distinct
-- from the requester (enforced at the API layer, not here), and expires —
-- at which point the violation automatically reopens (see the waiver-reaper
-- in governance-service/src/lib/waiver-reaper.js) rather than staying
-- silently waived forever. renewal_limit/renewal_count bound how many times
-- a waiver can be re-requested before expiry without a fresh justification
-- review being forced.

CREATE TABLE IF NOT EXISTS governance.waivers (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  violation_id             UUID        NOT NULL REFERENCES governance.violations(id) ON DELETE CASCADE,
  policy_being_waived      UUID        REFERENCES governance.policies(id),
  justification            TEXT        NOT NULL,
  risk_acceptance          TEXT,
  compensating_controls    TEXT,
  requested_by             TEXT        NOT NULL,
  approver                 TEXT,
  scope                    TEXT,
  status                   TEXT        NOT NULL DEFAULT 'pending'
                                        CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  valid_from               TIMESTAMPTZ,
  expires_at               TIMESTAMPTZ NOT NULL,
  renewal_limit            INT         NOT NULL DEFAULT 0,
  renewal_count            INT         NOT NULL DEFAULT 0,
  remediation_commitment   TEXT,
  residual_risk            TEXT,
  requested_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at               TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_waivers_violation ON governance.waivers(violation_id);
CREATE INDEX IF NOT EXISTS idx_waivers_status_expiry ON governance.waivers(status, expires_at);
