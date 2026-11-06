-- Fixes a naming-drift bug from migration 002: the column was created as
-- logic_json, but every caller (POST/PUT/GET /policies in
-- services/governance-service/src/routes/policies.js, and
-- web/src/pages/Governance.jsx + WorkflowGovernance.jsx) has always
-- referenced metadata_json, which never existed. logic_json is otherwise
-- unused anywhere in the codebase — this was a straight rename gone wrong,
-- not two separate features. POST /policies has been failing with
-- "column metadata_json does not exist" against any real database ever
-- since; unit tests never caught it because they mock the DB.
ALTER TABLE governance.policies RENAME COLUMN logic_json TO metadata_json;
ALTER INDEX IF EXISTS idx_policies_logic RENAME TO idx_policies_metadata;
