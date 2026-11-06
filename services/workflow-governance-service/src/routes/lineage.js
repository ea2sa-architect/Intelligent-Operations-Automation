import { Router } from 'express'
import pool from '../../db.js'
import { buildFromCorrelationChain, ingestEvent } from '../lib/lineage-builder.js'
import requireAuth, { requirePermission } from '../lib/require-auth.js'
import n8nClient from '../lib/n8n-client.js'

const router = Router()
// EP-308-S4 — this router had no auth at all, despite /ingest's own comment
// describing an INTERNAL_SERVICE_KEY auth path that only exists once
// requireAuth actually runs. router-level like tags.js/assurance.js;
// requireAuth's isService bypass is what makes telemetry-service's
// fire-and-forget POST /ingest calls keep working.
router.use(requireAuth)
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error('[lineage]', err.message)
  res.status(500).json({ error: err.message })
})

// ── List recent chains ────────────────────────────────────────────────────────
router.get('/', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200)
  const { rows } = await pool.query(`
    SELECT
      n.correlation_id,
      COUNT(n.id)::int                                    AS node_count,
      COUNT(CASE WHEN n.is_external THEN 1 END)::int      AS external_count,
      array_agg(DISTINCT n.data_classification)           AS classifications,
      array_agg(DISTINCT n.data_region) FILTER
        (WHERE n.data_region IS NOT NULL)                 AS regions,
      MIN(n.created_at)                                   AS chain_start,
      MAX(n.created_at)                                   AS chain_end
    FROM lineage_nodes n
    GROUP BY n.correlation_id
    ORDER BY MAX(n.created_at) DESC
    LIMIT $1
  `, [limit])
  res.json(rows)
}))

// ── Force-build lineage from telemetry correlation chain ──────────────────────
// Fetches full chain from telemetry.metrics and rebuilds all nodes/edges.
// Safe to call multiple times — clears and recreates the chain.
router.post('/build', requirePermission('workflow:read'), wrap(async (req, res) => {
  const { correlation_id } = req.body
  if (!correlation_id) return res.status(400).json({ error: 'correlation_id required' })
  const result = await buildFromCorrelationChain(correlation_id)
  res.json({ correlation_id, ...result })
}))

// ── Internal ingest hook — called fire-and-forget by telemetry-service ────────
// Exempt from CSRF (x-internal-service-key auth path, no browser cookie).
router.post('/ingest', requirePermission('telemetry:write'), wrap(async (req, res) => {
  const { correlation_id, service_name, metric_name, value, labels_json, time } = req.body
  if (!correlation_id || !service_name) {
    return res.status(400).json({ error: 'correlation_id and service_name required' })
  }
  await ingestEvent({ correlation_id, service_name, metric_name, value, labels_json, time })
  res.status(202).json({ ok: true })
}))

// ── Get violations linked to lineage chains ───────────────────────────────────
router.get('/violations', wrap(async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT * FROM governance.violations
    WHERE entity_type = 'lineage'
    ORDER BY detected_at DESC
    LIMIT 100
  `)
  res.json(rows)
}))

// Enriches lineage nodes with n8n execution/node linkage (see
// db/migrations/ai_inference/005_n8n_execution_linkage.sql): a 'model'-type
// node whose telemetry event carried n8n_execution_id/n8n_node_name has
// those forwarded verbatim into metadata_json by lineage-builder.js's
// `{...labels}` spread, so no lineage-builder.js change was needed — this
// is purely a read-time enrichment: resolve the owning workflow's display
// name and build a clickable n8n deep link.
async function attachN8nLinkage(nodes) {
  const workflowIds = [...new Set(
    nodes.map(n => n.metadata_json?.workflow_id).filter(Boolean)
  )]
  let workflowsById = {}
  if (workflowIds.length) {
    const { rows } = await pool.query(
      'SELECT id, n8n_id, name FROM workflow_governance.workflows WHERE id = ANY($1) OR n8n_id = ANY($1)',
      [workflowIds]
    )
    workflowsById = Object.fromEntries(
      rows.flatMap(w => [[w.id, w], [w.n8n_id, w]].filter(([k]) => k))
    )
  }

  return nodes.map(n => {
    const meta = n.metadata_json ?? {}
    const executionId = meta.n8n_execution_id
    if (!executionId) return { ...n, n8n: null }

    const workflowId = meta.workflow_id ?? null
    const workflow    = workflowId ? workflowsById[workflowId] : null
    return {
      ...n,
      n8n: {
        workflow_id:    workflowId,
        workflow_name:  workflow?.name ?? null,
        execution_id:   executionId,
        node_name:      meta.n8n_node_name ?? null,
        execution_url:  n8nClient.buildExecutionUrl(workflow?.n8n_id ?? workflowId, executionId),
      },
    }
  })
}

// ── Full graph for one correlation chain ──────────────────────────────────────
router.get('/:correlation_id', wrap(async (req, res) => {
  const cid = req.params.correlation_id

  const [nodesRes, edgesRes] = await Promise.all([
    pool.query(
      'SELECT * FROM lineage_nodes WHERE correlation_id=$1 ORDER BY created_at ASC',
      [cid]
    ),
    pool.query(`
      SELECT e.*,
        fn.node_name AS from_name, fn.node_type AS from_type,
        tn.node_name AS to_name,   tn.node_type AS to_type
      FROM lineage_edges e
      JOIN lineage_nodes fn ON fn.id = e.from_node_id
      JOIN lineage_nodes tn ON tn.id = e.to_node_id
      WHERE fn.correlation_id = $1
    `, [cid]),
  ])

  if (!nodesRes.rows.length) return res.status(404).json({ error: 'No lineage found for this correlation ID' })
  const nodes = await attachN8nLinkage(nodesRes.rows)
  res.json({ correlation_id: cid, nodes, edges: edgesRes.rows })
}))

export default router
