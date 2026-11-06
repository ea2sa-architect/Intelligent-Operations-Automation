// EP-104-S3 — a waiver's expiry is time-based, not something a human action
// triggers, so it needs a periodic sweep — same startup-sweep-plus-interval
// pattern as mcp-governance-service's assurance-reaper.js. Scoped to waivers
// whose violation is STILL 'waived_temporarily' (not just the waiver's own
// status) — if the violation was already resolved through some other path
// while the waiver was still technically 'approved', an expiring waiver
// must not un-resolve it.

import pool from '../../db.js';
import { transitionViolation } from '../routes/violations.js';

async function reopenExpiredWaivers() {
  const { rows: expired } = await pool.query(
    `SELECT w.id, w.violation_id
       FROM waivers w JOIN violations v ON v.id = w.violation_id
      WHERE w.status = 'approved' AND w.expires_at < NOW() AND v.status = 'waived_temporarily'`
  );

  for (const w of expired) {
    await pool.query(`UPDATE waivers SET status = 'expired' WHERE id = $1`, [w.id]);
    await transitionViolation(w.violation_id, 'reopened', { reason: 'Waiver expired', actor: 'system' });
  }

  return expired.length;
}

function startReaper(intervalMs = 60_000) {
  return setInterval(() => {
    reopenExpiredWaivers().catch(err => console.error('[waiver-reaper]', err.message));
  }, intervalMs);
}

export default { reopenExpiredWaivers, startReaper };
