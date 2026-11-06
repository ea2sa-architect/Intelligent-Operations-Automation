// EP-105-S5 — "re-evaluate when approval expires or is revoked." Revocation
// (PATCH /servers/:id/status, PATCH /tools/:id/approval) already triggers
// governanceClient.evaluateServer synchronously at the point of change.
// Expiration is time-based, not something a human action triggers — same
// startup-sweep-plus-interval pattern as assurance-reaper.js/waiver-reaper.js.
// Re-evaluating an already-flagged server is a no-op (rule-evaluator's
// reconciliation only creates/reopens a violation if one isn't already
// active), so it's safe to keep sweeping the same expired server on every tick.

import pool from '../../db.js';
import governanceClient from './governance-client.js';

async function reevaluateExpiredApprovals() {
  const { rows: expired } = await pool.query(
    `SELECT id FROM mcp_governance.mcp_servers
      WHERE status = 'approved' AND expiration_date IS NOT NULL AND expiration_date < NOW()`
  );

  for (const server of expired) {
    await governanceClient.evaluateServer(server.id);
  }

  return expired.length;
}

function startReaper(intervalMs = 60_000) {
  return setInterval(() => {
    reevaluateExpiredApprovals().catch(err => console.error('[approval-expiration-reaper]', err.message));
  }, intervalMs);
}

export default { reevaluateExpiredApprovals, startReaper };
