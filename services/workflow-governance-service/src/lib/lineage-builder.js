// EP-304 — Builds lineage_nodes + lineage_edges from a telemetry correlation chain.
// Reads telemetry.metrics via cross-schema SQL (same DB, same ioa user).
// Writes into workflow_governance.lineage_nodes/edges (this service's schema).
// Also detects external processors (S5) and cross-border transfers (S6),
// opening governance.violations for each finding.

import pool from '../../db.js'
import { scoreExecution } from './baseline-engine.js'

const INTERNAL_SERVICES = new Set([
  'workflow-governance-service',
  'ai-inference-service',
  'audit-service',
  'escalation-service',
  'telemetry-service',
  'governance-service',
  'auth-service',
  'mcp-governance-service',
])

// Built-in PII patterns (augmented at runtime with admin-configured patterns)
const BUILTIN_PII = [
  /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/,          // email
  /\b\d{3}-\d{2}-\d{4}\b/,                                     // SSN
  /\b(?:\d[ -]?){13,16}\b/,                                    // credit card
  /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/,                            // phone
  /\b(?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*\S+/i,
]

function deriveNodeType(serviceName, metricName) {
  if (serviceName === 'workflow-governance-service') return 'workflow'
  if (serviceName === 'ai-inference-service')        return 'model'
  if (serviceName === 'mcp-governance-service') {
    return (metricName ?? '').includes('tool') ? 'tool' : 'mcp_server'
  }
  if (serviceName === 'audit-service')         return 'database'
  if (serviceName === 'escalation-service')    return 'webhook'
  return 'external_api'
}

function deriveNodeId(serviceName, labelsJson) {
  return (
    labelsJson.workflow_id  ??
    labelsJson.tool_id      ??
    labelsJson.server_id    ??
    labelsJson.model_id     ??
    labelsJson.model        ??
    serviceName
  )
}

function deriveNodeName(metricName, labelsJson) {
  return (
    labelsJson.workflow_name ??
    labelsJson.tool_name     ??
    labelsJson.server_name   ??
    labelsJson.model_name    ??
    labelsJson.model         ??
    metricName
  )
}

function classifyData(labelsJson, customPatterns) {
  const values = Object.values(labelsJson ?? {})
    .filter(v => typeof v === 'string')

  for (const val of values) {
    for (const re of BUILTIN_PII) {
      if (re.test(val)) return 'pii'
    }
    for (const cp of customPatterns) {
      try {
        if (new RegExp(cp.pattern).test(val)) return 'pii'
      } catch { /* bad pattern — skip */ }
    }
  }
  return 'internal'
}

async function getCustomPatterns() {
  try {
    const { rows } = await pool.query(
      'SELECT pattern FROM mcp_governance.redaction_patterns WHERE enabled = true'
    )
    return rows
  } catch {
    return []
  }
}

async function openViolationIfAbsent(entityId, conditionType, severity, message) {
  try {
    await pool.query(`
      WITH rule AS (
        SELECT pr.id AS rule_id, pr.policy_id
        FROM governance.policy_rules pr
        JOIN governance.policies p ON p.id = pr.policy_id
        WHERE p.name = 'Data Lineage'
          AND pr.condition_json->>'type' = $3
        LIMIT 1
      )
      INSERT INTO governance.violations
        (entity_type, entity_id, rule_id, policy_id, severity, message, status)
      SELECT 'lineage', $1, rule.rule_id, rule.policy_id, $2, $4, 'open'
      FROM rule
      WHERE NOT EXISTS (
        SELECT 1 FROM governance.violations v
        WHERE v.entity_type = 'lineage'
          AND v.entity_id   = $1
          AND v.status IN ('open','acknowledged','remediating','reopened')
      )
    `, [entityId, severity, conditionType, message])
  } catch (err) {
    console.error('[lineage-builder] violation insert failed:', err.message)
  }
}

export async function buildFromCorrelationChain(correlationId) {
  // Pull full chain from telemetry (cross-schema — same Postgres instance)
  const { rows: events } = await pool.query(`
    SELECT time, service_name, metric_name, value, labels_json
    FROM telemetry.metrics
    WHERE correlation_id = $1
    ORDER BY time ASC
  `, [correlationId])

  if (!events.length) return { nodes: [], edges: [] }

  const customPatterns = await getCustomPatterns()
  const client = await pool.connect()
  const createdNodes = []

  try {
    await client.query('BEGIN')

    // Clear any existing nodes for this chain so a rebuild is idempotent
    await client.query(
      'DELETE FROM lineage_nodes WHERE correlation_id = $1',
      [correlationId]
    )

    for (const event of events) {
      const labels      = event.labels_json ?? {}
      const nodeType    = deriveNodeType(event.service_name, event.metric_name)
      const nodeId      = deriveNodeId(event.service_name, labels)
      const nodeName    = deriveNodeName(event.metric_name, labels)
      const isExternal  = !INTERNAL_SERVICES.has(event.service_name)
      const dataClass   = classifyData(labels, customPatterns)
      const dataRegion  = labels.region ?? labels.data_region ?? null

      const { rows: [node] } = await client.query(`
        INSERT INTO lineage_nodes
          (correlation_id, node_type, node_id, node_name, service_name,
           data_classification, is_external, data_region, metadata_json, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
      `, [
        correlationId, nodeType, nodeId, nodeName, event.service_name,
        dataClass, isExternal, dataRegion,
        { metric_name: event.metric_name, value: event.value, ...labels },
        event.time,
      ])

      createdNodes.push(node)
    }

    // Sequential edges between consecutive nodes
    for (let i = 1; i < createdNodes.length; i++) {
      await client.query(`
        INSERT INTO lineage_edges (from_node_id, to_node_id, transformation_type)
        VALUES ($1, $2, 'call')
      `, [createdNodes[i - 1].id, createdNodes[i].id])
    }

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // S5 — external processor violations (after transaction so IDs are committed)
  for (const node of createdNodes) {
    if (node.is_external) {
      await openViolationIfAbsent(
        correlationId,
        'external_processor_detected',
        'high',
        `External processor detected in correlation chain ${correlationId}: ${node.node_name ?? node.node_id} (${node.service_name})`
      )
    }
  }

  // S6 — cross-border transfer detection
  const regions = [...new Set(createdNodes.map(n => n.data_region).filter(Boolean))]
  if (regions.length > 1) {
    await openViolationIfAbsent(
      correlationId,
      'cross_border_transfer',
      'critical',
      `Cross-border data transfer detected in chain ${correlationId}: regions ${regions.join(' → ')}`
    )
  }

  // EP-305-S3: score this execution against its workflow's baseline (fire-and-forget)
  scoreExecution(correlationId).catch(err =>
    console.error('[lineage-builder] baseline scoring failed:', err.message)
  )

  const { rows: edges } = await pool.query(
    `SELECT e.*, fn.node_name AS from_name, tn.node_name AS to_name
     FROM lineage_edges e
     JOIN lineage_nodes fn ON fn.id = e.from_node_id
     JOIN lineage_nodes tn ON tn.id = e.to_node_id
     WHERE fn.correlation_id = $1`,
    [correlationId]
  )

  return { nodes: createdNodes, edges }
}

// Ingest a single metric event as a lineage node, connecting it to the
// previous node in the same chain (used by the fire-and-forget hook in
// telemetry-service).
export async function ingestEvent({ correlation_id, service_name, metric_name, value, labels_json, time }) {
  const customPatterns = await getCustomPatterns()
  const labels     = labels_json ?? {}
  const nodeType   = deriveNodeType(service_name, metric_name)
  const nodeId     = deriveNodeId(service_name, labels)
  const nodeName   = deriveNodeName(metric_name, labels)
  const isExternal = !INTERNAL_SERVICES.has(service_name)
  const dataClass  = classifyData(labels, customPatterns)
  const dataRegion = labels.region ?? labels.data_region ?? null

  const { rows: [node] } = await pool.query(`
    INSERT INTO lineage_nodes
      (correlation_id, node_type, node_id, node_name, service_name,
       data_classification, is_external, data_region, metadata_json, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
    RETURNING *
  `, [
    correlation_id, nodeType, nodeId, nodeName, service_name,
    dataClass, isExternal, dataRegion,
    { metric_name, value, ...labels },
    time ? new Date(time) : new Date(),
  ])

  // Edge from the most recent prior node in this chain
  const { rows: [prev] } = await pool.query(`
    SELECT id FROM lineage_nodes
    WHERE correlation_id = $1 AND id <> $2
    ORDER BY created_at DESC
    LIMIT 1
  `, [correlation_id, node.id])

  if (prev) {
    await pool.query(`
      INSERT INTO lineage_edges (from_node_id, to_node_id, transformation_type)
      VALUES ($1, $2, 'call')
    `, [prev.id, node.id])
  }

  // Immediate S5/S6 checks on the new node
  if (isExternal) {
    await openViolationIfAbsent(
      correlation_id, 'external_processor_detected', 'high',
      `External processor in chain ${correlation_id}: ${nodeName ?? nodeId}`
    )
  }
}
