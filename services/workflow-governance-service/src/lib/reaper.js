import pool from '../../db.js';

// On startup: mark any pending jobs that survived a service restart as failed.
// A 1-minute grace period avoids racing with jobs that were submitted milliseconds
// before the restart and may still have a valid n8n execution in flight.
export async function recoverOrphanedJobs() {
  try {
    const { rowCount } = await pool.query(`
      UPDATE workflow_governance.workflow_analyses
      SET    status = 'failed',
             error  = 'service restarted — job orphaned before callback arrived'
      WHERE  status = 'pending'
      AND    created_at < NOW() - INTERVAL '1 minute'
    `);
    if (rowCount > 0) {
      console.log(`[startup] Recovered ${rowCount} orphaned analysis job(s)`);
    }
  } catch (err) {
    console.error('[startup] Failed to recover orphaned jobs:', err.message);
  }
}

// Runs every 60 s: mark jobs whose expires_at has passed as failed.
// The partial index on (expires_at) WHERE status='pending' keeps this fast.
export function startReaper() {
  async function reap() {
    try {
      const { rowCount } = await pool.query(`
        UPDATE workflow_governance.workflow_analyses
        SET    status = 'failed',
               error  = 'analysis timeout — callback not received within expiry window'
        WHERE  status  = 'pending'
        AND    expires_at < NOW()
      `);
      if (rowCount > 0) {
        console.log(`[reaper] Reaped ${rowCount} timed-out analysis job(s)`);
      }
    } catch (err) {
      console.error('[reaper] Error during reap cycle:', err.message);
    }
  }

  setInterval(reap, 60_000);
  console.log('[reaper] Started — scanning for timed-out jobs every 60 s');
}
