import crypto from 'crypto';
import pool from '../../db.js';
import { SCORING_VERSION } from './risk-scorer.js';

// Excludes `discoveredAt` — metadata-extractor.js stamps that with `new Date()`
// on every extraction, which would otherwise make the hash change on every
// scan even when the workflow definition itself hasn't changed at all.
function hashMetadata(metadata) {
  const { discoveredAt, ...stable } = metadata;
  return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function countFindings(metadata) {
  const nodeFindings = (metadata.nodes || []).filter(n => (n.risk_factors || []).length > 0).length;
  const piiFindings  = metadata.piiExposure?.risks?.length || 0;
  return nodeFindings + piiFindings;
}

// Snapshots a risk score only when the underlying workflow definition actually
// changed (by hash) — re-discovering/re-scoring an unchanged workflow is a no-op,
// so history reflects real risk movement, not scan noise.
async function snapshotRiskScore({ workflowId, platform, riskScore, metadata }) {
  const hash = hashMetadata(metadata);

  const { rows: [last] } = await pool.query(
    `SELECT workflow_definition_hash
       FROM workflow_governance.workflow_risk_score_history
      WHERE workflow_id = $1
      ORDER BY scored_at DESC
      LIMIT 1`,
    [workflowId]
  );
  if (last?.workflow_definition_hash === hash) return null;

  const { rows: [snapshot] } = await pool.query(
    `INSERT INTO workflow_governance.workflow_risk_score_history
       (workflow_id, platform, overall_score, risk_level, dimension_scores,
        finding_count, scoring_version, workflow_definition_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [
      workflowId, platform, riskScore.risk_score, riskScore.risk_level,
      JSON.stringify(riskScore.dimensions), countFindings(metadata),
      SCORING_VERSION, hash,
    ]
  );
  return snapshot;
}

export default { snapshotRiskScore };
