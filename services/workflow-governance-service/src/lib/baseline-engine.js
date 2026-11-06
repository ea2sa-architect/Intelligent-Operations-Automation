// EP-305-S2/S3/S4 — Behavioral baseline computation and runtime deviation scoring.
// Baselines are derived from the last 30 days of telemetry correlation chains.
// Deviation scoring runs after each lineage build and fires anomaly_alerts +
// governance.violations for any threshold breaches.

import pool from '../../db.js'

async function openViolationIfAbsent(entityId, conditionType, severity, message) {
  try {
    await pool.query(`
      WITH rule AS (
        SELECT pr.id AS rule_id, pr.policy_id
        FROM governance.policy_rules pr
        JOIN governance.policies p ON p.id = pr.policy_id
        WHERE p.name = 'Behavioral Anomaly'
          AND pr.condition_json->>'type' = $3
        LIMIT 1
      )
      INSERT INTO governance.violations
        (entity_type, entity_id, rule_id, policy_id, severity, message, status)
      SELECT 'anomaly', $1, rule.rule_id, rule.policy_id, $2, $4, 'open'
      FROM rule
      WHERE NOT EXISTS (
        SELECT 1 FROM governance.violations v
        WHERE v.entity_type = 'anomaly'
          AND v.entity_id   = $1
          AND v.status IN ('open','acknowledged','remediating','reopened')
      )
    `, [entityId, severity, conditionType, message])
  } catch (err) {
    console.error('[baseline-engine] violation insert failed:', err.message)
  }
}

// ── Baseline derivation ────────────────────────────────────────────────────

export async function computeBaseline(workflowId) {
  // Find correlation chains for this workflow in the last 30 days.
  // Workflows emit telemetry with service_name = 'workflow:<id>' and
  // metric_name = 'execution_status', or include workflow_id in labels_json.
  const { rows: chainRows } = await pool.query(`
    SELECT DISTINCT correlation_id
    FROM telemetry.metrics
    WHERE (
        service_name = $1
      OR labels_json->>'workflow_id' = $2
    )
      AND time > NOW() - INTERVAL '30 days'
      AND correlation_id IS NOT NULL
  `, [`workflow:${workflowId}`, workflowId])

  if (!chainRows.length) return null

  const samples   = []
  const allTools  = new Set()
  const allDests  = new Set()

  for (const { correlation_id } of chainRows) {
    const { rows: nodes } = await pool.query(`
      SELECT node_type, node_id, node_name, service_name, is_external, created_at
      FROM lineage_nodes
      WHERE correlation_id = $1
      ORDER BY created_at ASC
    `, [correlation_id])

    if (nodes.length < 2) continue

    const toolNodes = nodes.filter(n => ['tool','mcp_server','model'].includes(n.node_type))
    const toolSeq   = toolNodes.map(n => n.node_name ?? n.node_id)
    toolSeq.forEach(t => allTools.add(t))

    nodes.filter(n => n.is_external).forEach(n => allDests.add(n.service_name))

    const first     = new Date(nodes[0].created_at).getTime()
    const last      = new Date(nodes[nodes.length - 1].created_at).getTime()
    const latencyMs = last - first

    let maxLoop = 0, curLoop = 1
    for (let i = 1; i < toolSeq.length; i++) {
      if (toolSeq[i] === toolSeq[i - 1]) { curLoop++; maxLoop = Math.max(maxLoop, curLoop) }
      else curLoop = 1
    }

    samples.push({ toolSeq, latencyMs, nodeCount: nodes.length, loopDepth: maxLoop })
  }

  if (!samples.length) return null

  const latencies = samples.map(s => s.latencyMs)
  const avg       = latencies.reduce((a, b) => a + b, 0) / latencies.length
  const variance  = latencies.reduce((a, b) => a + (b - avg) ** 2, 0) / latencies.length
  const stddev    = Math.sqrt(variance)
  const sorted    = [...latencies].sort((a, b) => a - b)
  const p95       = sorted[Math.floor(0.95 * sorted.length)]

  // Most-common tool sequence (mode by JSON key)
  const seqCounts = {}
  samples.forEach(s => {
    const k = JSON.stringify(s.toolSeq)
    seqCounts[k] = (seqCounts[k] ?? 0) + 1
  })
  const typicalSeq = JSON.parse(
    Object.entries(seqCounts).sort((a, b) => b[1] - a[1])[0][0]
  )

  const baseline = {
    workflowId,
    typicalToolSequence: typicalSeq,
    knownTools:          [...allTools],
    knownDestinations:   [...allDests],
    avgLatencyMs:        avg,
    p95LatencyMs:        p95,
    stddevLatencyMs:     stddev,
    avgNodeCount:        samples.reduce((a, s) => a + s.nodeCount, 0) / samples.length,
    maxLoopDepth:        Math.max(...samples.map(s => s.loopDepth)),
    sampleCount:         samples.length,
  }

  await pool.query(`
    INSERT INTO behavior_baselines
      (workflow_id, typical_tool_sequence, known_tools, known_destinations,
       avg_latency_ms, p95_latency_ms, stddev_latency_ms, avg_node_count,
       max_loop_depth, sample_count, computed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
    ON CONFLICT (workflow_id) DO UPDATE SET
      typical_tool_sequence = EXCLUDED.typical_tool_sequence,
      known_tools           = EXCLUDED.known_tools,
      known_destinations    = EXCLUDED.known_destinations,
      avg_latency_ms        = EXCLUDED.avg_latency_ms,
      p95_latency_ms        = EXCLUDED.p95_latency_ms,
      stddev_latency_ms     = EXCLUDED.stddev_latency_ms,
      avg_node_count        = EXCLUDED.avg_node_count,
      max_loop_depth        = EXCLUDED.max_loop_depth,
      sample_count          = EXCLUDED.sample_count,
      computed_at           = NOW()
  `, [
    workflowId,
    JSON.stringify(baseline.typicalToolSequence),
    JSON.stringify(baseline.knownTools),
    JSON.stringify(baseline.knownDestinations),
    baseline.avgLatencyMs,
    baseline.p95LatencyMs,
    baseline.stddevLatencyMs,
    baseline.avgNodeCount,
    baseline.maxLoopDepth,
    baseline.sampleCount,
  ])

  return baseline
}

// ── Deviation scoring ──────────────────────────────────────────────────────

export async function scoreExecution(correlationId) {
  const { rows: nodes } = await pool.query(`
    SELECT node_type, node_id, node_name, service_name, is_external, created_at
    FROM lineage_nodes
    WHERE correlation_id = $1
    ORDER BY created_at ASC
  `, [correlationId])

  if (nodes.length < 2) return []

  // Resolve workflow_id from telemetry labels or the workflow node itself
  const workflowNode = nodes.find(n => n.node_type === 'workflow')
  let workflowId = workflowNode?.node_id ?? null

  if (!workflowId) {
    const { rows: [tm] } = await pool.query(`
      SELECT labels_json->>'workflow_id' AS wid
      FROM telemetry.metrics
      WHERE correlation_id = $1
        AND labels_json->>'workflow_id' IS NOT NULL
      LIMIT 1
    `, [correlationId])
    workflowId = tm?.wid ?? null
  }

  if (!workflowId) return []

  const { rows: [baseline] } = await pool.query(
    'SELECT * FROM behavior_baselines WHERE workflow_id = $1',
    [workflowId]
  )
  if (!baseline) return []

  const alerts      = []
  const knownTools  = new Set(baseline.known_tools ?? [])
  const knownDests  = new Set(baseline.known_destinations ?? [])

  // S4-a: unexpected tool
  const toolNodes = nodes.filter(n => ['tool','mcp_server','model'].includes(n.node_type))
  const actualTools = toolNodes.map(n => n.node_name ?? n.node_id)
  for (const tool of actualTools) {
    if (!knownTools.has(tool)) {
      alerts.push({ type: 'unexpected_tool', severity: 'high', deviation: null,
        details: { tool, knownTools: [...knownTools] } })
    }
  }

  // S4-b: latency spike (z-score > 2.5)
  const firstMs   = new Date(nodes[0].created_at).getTime()
  const lastMs    = new Date(nodes[nodes.length - 1].created_at).getTime()
  const latencyMs = lastMs - firstMs
  const stddev    = parseFloat(baseline.stddev_latency_ms ?? 0)
  const avgMs     = parseFloat(baseline.avg_latency_ms ?? 0)
  if (stddev > 0) {
    const z = (latencyMs - avgMs) / stddev
    if (z > 2.5) {
      const severity = z > 4 ? 'critical' : z > 3 ? 'high' : 'medium'
      alerts.push({ type: 'latency_spike', severity, deviation: z,
        details: { latencyMs, avgMs, stddevMs: stddev, zScore: z } })
    }
  }

  // S4-c: new external destination
  const extNodes = nodes.filter(n => n.is_external)
  for (const n of extNodes) {
    if (!knownDests.has(n.service_name)) {
      alerts.push({ type: 'new_destination', severity: 'high', deviation: null,
        details: { destination: n.service_name, nodeName: n.node_name } })
    }
  }

  // S4-d: excessive loop
  let maxLoop = 0, curLoop = 1
  for (let i = 1; i < actualTools.length; i++) {
    if (actualTools[i] === actualTools[i - 1]) { curLoop++; maxLoop = Math.max(maxLoop, curLoop) }
    else curLoop = 1
  }
  if (maxLoop > (baseline.max_loop_depth ?? 0)) {
    alerts.push({ type: 'excessive_loop', severity: 'high',
      deviation: maxLoop - baseline.max_loop_depth,
      details: { actual: maxLoop, baselineMax: baseline.max_loop_depth } })
  }

  // Persist alerts and open violations
  for (const alert of alerts) {
    try {
      await pool.query(`
        INSERT INTO anomaly_alerts
          (workflow_id, correlation_id, alert_type, deviation_score, details_json, severity)
        VALUES ($1,$2,$3,$4,$5,$6)
      `, [workflowId, correlationId, alert.type, alert.deviation,
          JSON.stringify(alert.details), alert.severity])
    } catch { /* duplicate — ignore */ }

    await openViolationIfAbsent(
      correlationId, alert.type, alert.severity,
      `Behavioral anomaly [${alert.type}] in chain ${correlationId} (workflow ${workflowId})`
    )
  }

  return alerts
}
