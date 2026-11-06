-- EP-304 — Data Lineage & Sensitive Data Flow
-- lineage_nodes: one row per data-processing step in a correlation chain.
-- lineage_edges: directed edges (from_node → to_node) recording the flow.

BEGIN;

CREATE TABLE IF NOT EXISTS workflow_governance.lineage_nodes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id      TEXT        NOT NULL,
  node_type           TEXT        NOT NULL
    CHECK (node_type IN ('workflow','model','mcp_server','tool',
                         'external_api','database','webhook','user')),
  node_id             TEXT        NOT NULL,
  node_name           TEXT,
  service_name        TEXT,
  data_classification TEXT        NOT NULL DEFAULT 'unknown'
    CHECK (data_classification IN ('public','internal','confidential',
                                   'pii','restricted','unknown')),
  is_external         BOOLEAN     NOT NULL DEFAULT false,
  external_reason     TEXT,
  data_region         TEXT,
  metadata_json       JSONB       NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workflow_governance.lineage_edges (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id        UUID        NOT NULL
    REFERENCES workflow_governance.lineage_nodes(id) ON DELETE CASCADE,
  to_node_id          UUID        NOT NULL
    REFERENCES workflow_governance.lineage_nodes(id) ON DELETE CASCADE,
  transformation_type TEXT        NOT NULL DEFAULT 'call'
    CHECK (transformation_type IN ('call','response','transform',
                                   'store','forward','trigger')),
  data_transferred    TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lineage_nodes_correlation
  ON workflow_governance.lineage_nodes(correlation_id);

CREATE INDEX IF NOT EXISTS idx_lineage_nodes_classification
  ON workflow_governance.lineage_nodes(data_classification);

CREATE INDEX IF NOT EXISTS idx_lineage_nodes_external
  ON workflow_governance.lineage_nodes(is_external)
  WHERE is_external = true;

CREATE INDEX IF NOT EXISTS idx_lineage_edges_from
  ON workflow_governance.lineage_edges(from_node_id);

CREATE INDEX IF NOT EXISTS idx_lineage_edges_to
  ON workflow_governance.lineage_edges(to_node_id);

COMMIT;
