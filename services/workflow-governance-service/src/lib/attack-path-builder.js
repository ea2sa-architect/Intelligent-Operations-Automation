// EP-305-S5/S6 — Attack-path reachability graph per MCP server.
// Cross-schema reads: mcp_governance.mcp_servers, mcp_governance.tool_definitions,
// workflow_governance.lineage_nodes.
// Identifies excessive scope, PII egress risk, and cross-server trust paths.

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
      SELECT 'attack_path', $1, rule.rule_id, rule.policy_id, $2, $4, 'open'
      FROM rule
      WHERE NOT EXISTS (
        SELECT 1 FROM governance.violations v
        WHERE v.entity_type = 'attack_path'
          AND v.entity_id   = $1
          AND v.status IN ('open','acknowledged','remediating','reopened')
      )
    `, [entityId, severity, conditionType, message])
  } catch (err) {
    console.error('[attack-path-builder] violation insert failed:', err.message)
  }
}

export async function buildAttackPath(mcpServerId) {
  const { rows: [server] } = await pool.query(`
    SELECT id, name, base_url, trust_level, status
    FROM mcp_governance.mcp_servers
    WHERE id = $1
  `, [mcpServerId])

  if (!server) return null

  // S5-a: enumerate reachable tools for this server
  const { rows: tools } = await pool.query(`
    SELECT id, name, description, risk_level
    FROM mcp_governance.tool_definitions
    WHERE server_id = $1
    ORDER BY name
  `, [mcpServerId])

  // S5-b: external destinations reached by chains that include this server's node
  // lineage_nodes.node_id stores labels_json.server_id when available
  const { rows: destinations } = await pool.query(`
    SELECT DISTINCT
      ext.service_name,
      ext.node_name,
      ext.data_classification,
      ext.data_region
    FROM lineage_nodes ext
    WHERE ext.is_external = true
      AND EXISTS (
        SELECT 1 FROM lineage_nodes srv
        WHERE srv.correlation_id = ext.correlation_id
          AND (srv.node_id = $1::text OR srv.service_name = 'mcp-governance-service')
          AND srv.node_type IN ('mcp_server','tool')
      )
    ORDER BY ext.service_name
  `, [mcpServerId])

  // S5-c: other MCP servers appearing in the same correlation chains (shared trust paths)
  const { rows: peerRows } = await pool.query(`
    SELECT DISTINCT
      peer.node_id   AS peer_server_id,
      peer.node_name AS peer_server_name
    FROM lineage_nodes peer
    WHERE peer.node_type IN ('mcp_server','tool')
      AND peer.node_id <> $1::text
      AND EXISTS (
        SELECT 1 FROM lineage_nodes srv
        WHERE srv.correlation_id = peer.correlation_id
          AND srv.node_id = $1::text
      )
  `, [mcpServerId])

  // ── Risk scoring ────────────────────────────────────────────────────────

  const riskFactors = []
  let riskScore = 0

  // Tool count — blast radius
  const TOOL_SCOPE_THRESHOLD = 8
  if (tools.length > TOOL_SCOPE_THRESHOLD) {
    const excess = tools.length - TOOL_SCOPE_THRESHOLD
    riskScore += Math.min(excess * 4, 25)
    riskFactors.push({
      factor: 'excessive_scope',
      severity: 'high',
      detail: `${tools.length} tools registered (threshold: ${TOOL_SCOPE_THRESHOLD})`,
    })
  }

  // High-risk tools
  const highRiskTools = tools.filter(t => t.risk_level === 'high' || t.risk_level === 'critical')
  if (highRiskTools.length) {
    riskScore += highRiskTools.length * 10
    riskFactors.push({
      factor: 'high_risk_tools',
      severity: 'high',
      detail: highRiskTools.map(t => t.name).join(', '),
    })
  }

  // External destinations
  if (destinations.length) {
    riskScore += destinations.length * 5
    riskFactors.push({
      factor: 'external_data_egress',
      severity: 'medium',
      detail: `${destinations.length} external destination(s): ${destinations.map(d => d.service_name).join(', ')}`,
    })
  }

  // PII to external
  const piiDests = destinations.filter(
    d => d.data_classification === 'pii' || d.data_classification === 'restricted'
  )
  if (piiDests.length) {
    riskScore += piiDests.length * 20
    riskFactors.push({
      factor: 'pii_egress',
      severity: 'critical',
      detail: `PII data observed at: ${piiDests.map(d => d.service_name).join(', ')}`,
    })
  }

  // Cross-server trust paths (shared chain exposure)
  if (peerRows.length) {
    riskScore += Math.min(peerRows.length * 3, 15)
    riskFactors.push({
      factor: 'cross_server_trust',
      severity: 'medium',
      detail: `Shares execution chains with ${peerRows.length} other server(s)`,
    })
  }

  riskScore = Math.min(Math.round(riskScore), 100)

  // Persist / update
  await pool.query(`
    INSERT INTO attack_paths
      (mcp_server_id, server_name, reachable_tools, external_destinations,
       cross_server_paths, risk_factors, risk_score, computed_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
    ON CONFLICT (mcp_server_id) DO UPDATE SET
      server_name           = EXCLUDED.server_name,
      reachable_tools       = EXCLUDED.reachable_tools,
      external_destinations = EXCLUDED.external_destinations,
      cross_server_paths    = EXCLUDED.cross_server_paths,
      risk_factors          = EXCLUDED.risk_factors,
      risk_score            = EXCLUDED.risk_score,
      computed_at           = NOW()
  `, [
    mcpServerId,
    server.name,
    JSON.stringify(tools.map(t => ({ id: t.id, name: t.name, risk_level: t.risk_level }))),
    JSON.stringify(destinations),
    JSON.stringify(peerRows),
    JSON.stringify(riskFactors),
    riskScore,
  ])

  // S6: open violations for critical findings
  const serverId = String(mcpServerId)
  if (riskFactors.some(f => f.factor === 'excessive_scope')) {
    await openViolationIfAbsent(serverId, 'excessive_scope', 'high',
      `MCP server "${server.name}" exposes ${tools.length} tools — excessive blast radius on compromise`)
  }
  if (riskFactors.some(f => f.factor === 'pii_egress')) {
    await openViolationIfAbsent(serverId, 'pii_egress', 'critical',
      `MCP server "${server.name}" has forwarded PII to external destinations: ${piiDests.map(d => d.service_name).join(', ')}`)
  }

  return { server, tools, destinations, crossServerPaths: peerRows, riskFactors, riskScore }
}

export async function buildAllAttackPaths() {
  const { rows: servers } = await pool.query(`
    SELECT id FROM mcp_governance.mcp_servers WHERE status = 'approved'
  `)
  const results = []
  for (const { id } of servers) {
    try {
      const r = await buildAttackPath(id)
      if (r) results.push({ id, riskScore: r.riskScore })
    } catch (err) {
      console.error(`[attack-path-builder] failed for server ${id}:`, err.message)
    }
  }
  return results
}
