-- EP-103-S4/S5 — the MCP history tables predate this epic but were only
-- ever soft-enforced (no UPDATE/DELETE route calls them). Same hard
-- DB-level guarantee as governance.violation_history/approval_decision_history.
--
-- Note: mcp_tools/mcp_servers/mcp_prompts all have ON DELETE CASCADE FKs
-- from their history tables. Deleting a server/tool/prompt that has any
-- history now fails (the cascade attempt hits this trigger) rather than
-- silently discarding its audit trail — a deliberate side effect of making
-- the guarantee real, not a bug.

CREATE OR REPLACE FUNCTION mcp_governance.prevent_history_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'mcp_governance.% is append-only — % is not permitted', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mcp_server_status_history_no_update ON mcp_governance.mcp_server_status_history;
CREATE TRIGGER mcp_server_status_history_no_update
  BEFORE UPDATE ON mcp_governance.mcp_server_status_history
  FOR EACH ROW EXECUTE FUNCTION mcp_governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS mcp_server_status_history_no_delete ON mcp_governance.mcp_server_status_history;
CREATE TRIGGER mcp_server_status_history_no_delete
  BEFORE DELETE ON mcp_governance.mcp_server_status_history
  FOR EACH ROW EXECUTE FUNCTION mcp_governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS mcp_tool_decision_history_no_update ON mcp_governance.mcp_tool_decision_history;
CREATE TRIGGER mcp_tool_decision_history_no_update
  BEFORE UPDATE ON mcp_governance.mcp_tool_decision_history
  FOR EACH ROW EXECUTE FUNCTION mcp_governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS mcp_tool_decision_history_no_delete ON mcp_governance.mcp_tool_decision_history;
CREATE TRIGGER mcp_tool_decision_history_no_delete
  BEFORE DELETE ON mcp_governance.mcp_tool_decision_history
  FOR EACH ROW EXECUTE FUNCTION mcp_governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS mcp_tool_definition_history_no_update ON mcp_governance.mcp_tool_definition_history;
CREATE TRIGGER mcp_tool_definition_history_no_update
  BEFORE UPDATE ON mcp_governance.mcp_tool_definition_history
  FOR EACH ROW EXECUTE FUNCTION mcp_governance.prevent_history_mutation();

DROP TRIGGER IF EXISTS mcp_tool_definition_history_no_delete ON mcp_governance.mcp_tool_definition_history;
CREATE TRIGGER mcp_tool_definition_history_no_delete
  BEFORE DELETE ON mcp_governance.mcp_tool_definition_history
  FOR EACH ROW EXECUTE FUNCTION mcp_governance.prevent_history_mutation();
