-- EP-203-S1 — containment is orthogonal to approval status: an approved,
-- perfectly-reviewed server can still need to be pulled offline mid-incident
-- without losing its approval record. 'active' is the only state that lets
-- Kong routing and /enforce traffic through — see kong-provisioner.js and
-- governance-service's /enforce for the two enforcement points that check it.
ALTER TABLE mcp_governance.mcp_servers
  ADD COLUMN IF NOT EXISTS containment_state TEXT NOT NULL DEFAULT 'active'
    CHECK (containment_state IN ('active', 'suspended', 'quarantined', 'read_only'));

ALTER TABLE mcp_governance.mcp_tools
  ADD COLUMN IF NOT EXISTS containment_state TEXT NOT NULL DEFAULT 'active'
    CHECK (containment_state IN ('active', 'suspended', 'quarantined', 'read_only'));
