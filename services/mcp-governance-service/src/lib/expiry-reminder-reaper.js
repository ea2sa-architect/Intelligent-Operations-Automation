// EP-202-S6 — "Reminder escalation: 30d, 7d, 1d before expiry →
// escalation-service incident." Same startup-sweep-plus-interval pattern as
// assurance-reaper.js/waiver-reaper.js, but on an hourly cadence rather than
// 60s — the underlying data (expiration_date) only has day-level
// granularity, so there's nothing to gain from checking more often, and
// this can genuinely queries every approved server with an expiration date.
//
// The incident is created BEFORE the dedup row is inserted, not after — if
// escalation-service is unreachable, createIncident fails soft (returns
// null) and no dedup row is written, so the next tick retries. Missing a
// reminder is worse than an occasional duplicate.

import pool from '../../db.js';
import escalationClient from './escalation-client.js';

const THRESHOLDS_DAYS = [30, 7, 1];
const SEVERITY_BY_THRESHOLD = { 30: 'medium', 7: 'high', 1: 'critical' };

async function sendExpiryReminders() {
  let sent = 0;

  for (const days of THRESHOLDS_DAYS) {
    // NOT EXISTS excludes servers already reminded at this threshold — the
    // dedup table is checked here, not just at insert time, so a server
    // sitting inside the window doesn't get a fresh escalation-service
    // incident on every single tick. The later INSERT...ON CONFLICT is a
    // safety net against two overlapping ticks racing, not the primary guard.
    // $1 is cast explicitly in both places — left as a bare parameter, using
    // it in both a string-concat context (::interval) and an integer
    // equality context (threshold_days) in the same query confuses
    // Postgres' type inference ("operator does not exist: integer = text").
    const { rows: dueServers } = await pool.query(
      `SELECT s.id, s.name, s.expiration_date FROM mcp_governance.mcp_servers s
        WHERE s.status = 'approved' AND s.expiration_date IS NOT NULL
          AND s.expiration_date > NOW() AND s.expiration_date <= NOW() + ($1::int || ' days')::interval
          AND NOT EXISTS (
            SELECT 1 FROM mcp_governance.expiry_reminders_sent r
             WHERE r.server_id = s.id AND r.threshold_days = $1::int
          )`,
      [days]
    );

    for (const server of dueServers) {
      const incident = await escalationClient.createIncident({
        title: `MCP server "${server.name}" approval expires in ${days} day(s)`,
        severity: SEVERITY_BY_THRESHOLD[days],
        contextJson: { server_id: server.id, expiration_date: server.expiration_date, threshold_days: days },
      });
      if (!incident) continue; // escalation-service unreachable — retry next tick, don't mark sent

      const { rows: [inserted] } = await pool.query(
        `INSERT INTO mcp_governance.expiry_reminders_sent (server_id, threshold_days)
         VALUES ($1, $2) ON CONFLICT (server_id, threshold_days) DO NOTHING RETURNING *`,
        [server.id, days]
      );
      if (inserted) sent += 1;
    }
  }

  return sent;
}

function startReaper(intervalMs = 60 * 60_000) {
  return setInterval(() => {
    sendExpiryReminders().catch(err => console.error('[expiry-reminder-reaper]', err.message));
  }, intervalMs);
}

export default { sendExpiryReminders, startReaper };
