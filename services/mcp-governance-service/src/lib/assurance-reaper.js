// Epic 6, Feature 6.4 — "evidence to move through collected, validated,
// rejected, expired, and superseded states." Expiration is time-based, not
// something a human action triggers, so it needs a periodic sweep — same
// startup-sweep-plus-interval pattern as workflow-governance-service's
// reaper.js (orphaned analysis jobs).

import pool from '../../db.js';

async function expireStaleEvidence() {
  await pool.query(
    `UPDATE mcp_governance.mcp_assurance_evidence
        SET status = 'expired'
      WHERE status = 'validated' AND expires_at IS NOT NULL AND expires_at < NOW()`
  );
}

function startReaper(intervalMs = 60_000) {
  return setInterval(() => {
    expireStaleEvidence().catch(err => console.error('[assurance-reaper]', err.message));
  }, intervalMs);
}

export default { expireStaleEvidence, startReaper };
