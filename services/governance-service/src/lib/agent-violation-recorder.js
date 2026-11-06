// EP-204-F3 — records a CRITICAL violation for an agent-identity security
// event (privilege escalation or confused deputy). Deliberately separate
// from rule-evaluator.js: everything there re-evaluates an entity's current
// stored state against its bound policies; these are one-shot events
// reported at the moment they happen; there's no "current state" of an
// agent to re-evaluate later, and no policy_binding lookup — every agent in
// the platform is implicitly covered by the single seeded boundary policy
// (031_agent_privilege_policy.sql), the same way every user is implicitly
// covered by auth's session rules without a per-user binding row.

import pool from '../../db.js';

const RULE_TYPES = ['agent_privilege_escalation', 'agent_confused_deputy'];

// Same de-dup spirit as rule-evaluator.js's active-message check — a
// mis-scoped or misconfigured agent making the same failing call repeatedly
// (e.g. a retry loop) should reopen/stay on one violation, not flood the
// Violations page with a new row per attempt.
export async function recordAgentSecurityEvent({ agentId, agentName, ruleType, message }) {
  if (!RULE_TYPES.includes(ruleType)) {
    throw new Error(`Unknown agent security rule_type: ${ruleType}`);
  }

  const { rows: [rule] } = await pool.query(
    `SELECT pr.id AS rule_id, pr.policy_id, p.version AS policy_version
       FROM policy_rules pr
       JOIN policies p ON p.id = pr.policy_id
      WHERE pr.rule_type = $1 AND pr.enabled = true
      LIMIT 1`,
    [ruleType]
  );
  if (!rule) throw new Error(`No enabled policy_rule seeded for rule_type: ${ruleType}`);

  const { rows: existing } = await pool.query(
    `SELECT id FROM violations
      WHERE entity_type = 'agent' AND entity_id = $1 AND rule_id = $2
        AND message = $3 AND status IN ('open', 'reopened')`,
    [agentId, rule.rule_id, message]
  );
  if (existing.length > 0) return existing[0];

  const { rows: [violation] } = await pool.query(
    `INSERT INTO violations (workflow_id, entity_type, entity_id, rule_id, policy_id, severity, message)
     VALUES (NULL, 'agent', $1, $2, $3, 'critical', $4)
     RETURNING *`,
    [agentId, rule.rule_id, rule.policy_id, message]
  );

  await pool.query(
    `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
     VALUES ($1, NULL, 'open', 'system', $2, $3)`,
    [violation.id, `Detected by EP-204-F3 (${ruleType})${agentName ? ` — agent "${agentName}"` : ''}`, rule.policy_version]
  );

  return violation;
}
