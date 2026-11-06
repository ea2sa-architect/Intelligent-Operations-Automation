import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';

// EP-304-S3 — fire-and-forget lineage rebuild after each metric batch.
// Calls /lineage/build per distinct correlation_id so the builder reads the
// full telemetry chain in time order (avoids race conditions in per-event
// ingest). One fetch per unique CID per batch — typically one.
// Uses INTERNAL_SERVICE_KEY; failures are silently swallowed — lineage is
// best-effort and must never slow the telemetry hot path.
const LINEAGE_URL = process.env.WORKFLOW_GOVERNANCE_URL ?? 'http://workflow-governance-service:3305'
const LINEAGE_KEY = process.env.INTERNAL_SERVICE_KEY ?? ''
function fireLineageBuild(correlationId) {
  if (!correlationId) return
  fetch(`${LINEAGE_URL}/lineage/build`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-service-key': LINEAGE_KEY },
    body:    JSON.stringify({ correlation_id: String(correlationId) }),
  }).catch(() => {})
}

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// Ingest one metric or a batch array.
// EP-102-S1/S2 — every ingested row gets a correlation_id: an explicit
// per-item value if the caller supplies one, otherwise the request-level id
// the correlationId middleware assigned (from x-correlation-id, or freshly
// minted). This is what lets a workflow-governance-service execution event
// and the mcp-governance-service tool invocations it triggers land in the
// same chain even if only one leg of the call explicitly threads an id.
router.post('/', requirePermission('telemetry:write'), wrap(async (req, res) => {
  const items = Array.isArray(req.body) ? req.body : [req.body];
  const required = items.filter(m => !m.service_name || !m.metric_name || m.value === undefined);
  if (required.length) return res.status(400).json({ error: 'Each metric requires service_name, metric_name, and value' });

  const rows = items.map(m => [
    m.time ?? new Date(),
    m.service_name,
    m.metric_name,
    m.value,
    m.labels_json ?? {},
    m.correlation_id ?? req.correlationId,
  ]);

  // Batch insert
  const placeholders = rows.map((_, i) => `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`).join(', ');
  await pool.query(
    `INSERT INTO metrics (time, service_name, metric_name, value, labels_json, correlation_id) VALUES ${placeholders}`,
    rows.flat()
  );

  // EP-304-S3 — async lineage rebuild (fire-and-forget, does not affect response)
  // Deduplicate: one build call per distinct correlation_id in this batch.
  const distinctCids = [...new Set(rows.map(r => r[5]).filter(Boolean))]
  distinctCids.forEach(fireLineageBuild)

  res.status(202).json({ ingested: rows.length });
}));

// Query metrics. Epic 6, Feature 6.1: beyond service_name/metric_name/time
// range, MCP tool invocation telemetry needs to be queryable by fields that
// live inside labels_json (server_id, tool_id, client_id, workflow_id) —
// supported generically here via ?label_<key>=<value> so any future
// labels_json field is queryable without another route change.
// EP-102-S2 — correlation_id is a first-class column now (not just
// labels_json), so it gets its own top-level filter rather than requiring
// ?label_correlation_id=... (that still works too, for anything still
// reading it out of labels_json, but the indexed column is what /correlation
// below and any future high-volume chain lookup should use).
router.get('/', wrap(async (req, res) => {
  const { service_name, metric_name, correlation_id, from, to, limit = 500, ...rest } = req.query;
  const conditions = [];
  const params = [];

  if (service_name)   { conditions.push(`service_name = $${params.push(service_name)}`); }
  if (metric_name)    { conditions.push(`metric_name = $${params.push(metric_name)}`); }
  if (correlation_id) { conditions.push(`correlation_id = $${params.push(correlation_id)}`); }
  if (from)            { conditions.push(`time >= $${params.push(from)}`); }
  if (to)              { conditions.push(`time <= $${params.push(to)}`); }

  for (const [key, value] of Object.entries(rest)) {
    if (!key.startsWith('label_') || !value) continue;
    const labelKey = key.slice('label_'.length);
    conditions.push(`labels_json->>$${params.push(labelKey)} = $${params.push(value)}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(Math.min(Number(limit), 5000));

  const { rows } = await pool.query(
    `SELECT time, service_name, metric_name, value, labels_json, correlation_id
       FROM metrics ${where}
      ORDER BY time DESC
      LIMIT $${params.length}`,
    params
  );
  res.json(rows);
}));

// ── GET /metrics/correlation/:correlation_id ────────────────────────────────
// EP-102-S8's backend groundwork: the full chain of everything recorded
// under one correlation_id, in causal (chronological) order — a workflow
// execution event, the MCP tool invocations it triggered, and anything else
// that threaded the same x-correlation-id through. Ascending time order
// (unlike GET / above, which is most-recent-first) since a chain reads
// naturally start-to-finish.
router.get('/correlation/:correlation_id', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT time, service_name, metric_name, value, labels_json, correlation_id
       FROM metrics
      WHERE correlation_id = $1
      ORDER BY time ASC`,
    [req.params.correlation_id]
  );
  res.json(rows);
}));

// Aggregated summary: avg/min/max per service + metric over a window
router.get('/summary', wrap(async (req, res) => {
  const { from, to } = req.query;
  const conditions = [];
  const params = [];

  if (from) { conditions.push(`time >= $${params.push(from)}`); }
  if (to)   { conditions.push(`time <= $${params.push(to)}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
       service_name,
       metric_name,
       COUNT(*)              AS samples,
       ROUND(AVG(value)::numeric, 4) AS avg,
       ROUND(MIN(value)::numeric, 4) AS min,
       ROUND(MAX(value)::numeric, 4) AS max,
       MIN(time)             AS from,
       MAX(time)             AS to
     FROM metrics ${where}
     GROUP BY service_name, metric_name
     ORDER BY service_name, metric_name`,
    params
  );
  res.json(rows);
}));

// ── GET /metrics/workflows/:workflow_id/execution-summary ──────────────────
// Operational-visibility signal for a single workflow: last success/failure
// and 7-day failure rate, derived from execution_status events ingested via
// workflow-governance-service's POST /workflows/:id/execution-event.
router.get('/workflows/:workflow_id/execution-summary', wrap(async (req, res) => {
  const { rows: [row] } = await pool.query(
    `SELECT
       MAX(time) FILTER (WHERE labels_json->>'status' = 'success') AS last_success_at,
       MAX(time) FILTER (WHERE labels_json->>'status' = 'failure') AS last_failure_at,
       COUNT(*) FILTER (WHERE time > NOW() - INTERVAL '7 days')::int AS total_7d,
       COUNT(*) FILTER (WHERE time > NOW() - INTERVAL '7 days' AND labels_json->>'status' = 'failure')::int AS failures_7d
     FROM metrics
     WHERE service_name = $1 AND metric_name = 'execution_status'`,
    [`workflow:${req.params.workflow_id}`]
  );

  const total7d = row.total_7d ?? 0;
  res.json({
    last_success_at: row.last_success_at,
    last_failure_at: row.last_failure_at,
    total_executions_7d: total7d,
    failure_rate_7d: total7d > 0 ? Math.round((row.failures_7d / total7d) * 10000) / 100 : null,
  });
}));

export default router;
