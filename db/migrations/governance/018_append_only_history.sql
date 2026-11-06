-- EP-103-S4/S5 — history tables are audit trails: even an application bug
-- or a privileged DB user must not silently rewrite or erase one. Previously
-- enforced only in application code (no UPDATE/DELETE route exists for
-- either table) — this makes it a hard DB-level guarantee.

CREATE OR REPLACE FUNCTION governance.prevent_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'governance.% is append-only — % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS violation_history_no_update ON governance.violation_history;
CREATE TRIGGER violation_history_no_update
  BEFORE UPDATE ON governance.violation_history
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS violation_history_no_delete ON governance.violation_history;
CREATE TRIGGER violation_history_no_delete
  BEFORE DELETE ON governance.violation_history
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS approval_decision_history_no_update ON governance.approval_decision_history;
CREATE TRIGGER approval_decision_history_no_update
  BEFORE UPDATE ON governance.approval_decision_history
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS approval_decision_history_no_delete ON governance.approval_decision_history;
CREATE TRIGGER approval_decision_history_no_delete
  BEFORE DELETE ON governance.approval_decision_history
  FOR EACH ROW EXECUTE FUNCTION governance.prevent_history_mutation();
