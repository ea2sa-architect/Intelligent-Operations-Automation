-- EP-311-P5 — Certify mode's persisted decision. Distinct from
-- approval_decision_history (017): that table's supporting_evidence is
-- plain TEXT and decision is unconstrained free text — fine for a human-
-- typed approval log, too thin for a structured, machine-queryable
-- evidence bundle a later `ioa` run or the SPA needs to diff against. The
-- nullable approval_decision_id lets a human's formal sign-off (still
-- logged the old way) cross-reference a release_decisions row without
-- conflating the two purposes.

CREATE TABLE IF NOT EXISTS governance.release_decisions (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type           TEXT        NOT NULL DEFAULT 'workflow',
  entity_id             TEXT        NOT NULL,
  release_ref           TEXT,
  decision              TEXT        NOT NULL CHECK (decision IN ('certified', 'certified_with_waivers', 'rejected')),
  coverage_pct          NUMERIC,
  evidence_bundle_json  JSONB       NOT NULL DEFAULT '{}',
  waivers_json          JSONB       NOT NULL DEFAULT '[]',
  decided_by            TEXT        NOT NULL,
  approval_decision_id  UUID        REFERENCES governance.approval_decision_history(id),
  expiration            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_release_decisions_entity     ON governance.release_decisions(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_release_decisions_created_at ON governance.release_decisions(created_at DESC);
