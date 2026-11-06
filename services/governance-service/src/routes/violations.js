import { Router } from 'express';
import pool from '../../db.js';
import { evaluateWorkflow, evaluateMcpServer } from '../lib/rule-evaluator.js';
import { recordAgentSecurityEvent } from '../lib/agent-violation-recorder.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// EP-105-S1 — full lifecycle. 'waiver_requested'/'waived_temporarily' are
// reached only via the waiver routes below (POST .../waivers, PATCH
// .../approve), not directly through this generic status endpoint —  they
// carry requirements (justification, an approver distinct from the
// requester) this endpoint doesn't enforce.
const VALID_STATUSES   = ['open', 'acknowledged', 'remediating', 'resolved', 'reopened'];
const VALID_SEVERITIES = ['low', 'medium', 'high', 'critical'];

// EP-103-S1/S3 + EP-105-S1 — the one place a violation's status actually
// changes and its append-only history row gets written, shared by the
// generic status endpoint and the dedicated acknowledge/remediating/resolve
// ones below so they can't drift out of sync with each other.
async function transitionViolation(id, newStatus, { reason, evidenceId, actor } = {}) {
  const { rows: [existing] } = await pool.query(
    `SELECT v.status, p.version AS policy_version
       FROM violations v JOIN policies p ON p.id = v.policy_id
      WHERE v.id = $1`,
    [id]
  );
  if (!existing) return null;

  const resolved_at = (newStatus === 'resolved' || newStatus === 'waived_temporarily') ? new Date() : null;
  const { rows: [violation] } = await pool.query(
    `UPDATE violations
        SET status = $1, resolved_at = $2, resolution_reason = COALESCE($3, resolution_reason)
      WHERE id = $4
  RETURNING *`,
    [newStatus, resolved_at, reason ?? null, id]
  );

  await pool.query(
    `INSERT INTO violation_history
       (violation_id, prev_status, new_status, actor, reason, policy_version, evidence_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, existing.status, newStatus, actor ?? 'unknown', reason ?? null, existing.policy_version, evidenceId ?? null]
  );

  return violation;
}

// List violations — supports ?workflow_id, ?policy_id, ?status, ?severity,
// and ?entity_type/?entity_id for non-workflow entities (e.g. mcp_server)
router.get('/', wrap(async (req, res) => {
  const { workflow_id, policy_id, status, severity, entity_type, entity_id } = req.query;

  const conditions = [];
  const params     = [];

  // v.-qualified where the column also exists on a joined table (policies.status,
  // policy_rules.policy_id/severity) — unqualified references were ambiguous and
  // threw a real Postgres error whenever entity_type/entity_id was combined with
  // status or severity, invisible to the mocked test suite since it never parses
  // real SQL. workflow_id/entity_type/entity_id are violations-only columns.
  if (workflow_id) { params.push(workflow_id); conditions.push(`workflow_id = $${params.length}`); }
  if (policy_id)   { params.push(policy_id);   conditions.push(`v.policy_id = $${params.length}`); }
  if (status)      { params.push(status);       conditions.push(`v.status = $${params.length}`); }
  if (severity)    { params.push(severity);     conditions.push(`v.severity = $${params.length}`); }
  if (entity_type) { params.push(entity_type);  conditions.push(`entity_type = $${params.length}`); }
  if (entity_id)   { params.push(entity_id);    conditions.push(`entity_id = $${params.length}`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await pool.query(
    `SELECT v.*,
            p.name  AS policy_name,
            pr.rule_type,
            pr.config_json
       FROM violations v
       JOIN policies p      ON p.id = v.policy_id
       JOIN policy_rules pr ON pr.id = v.rule_id
     ${where}
     ORDER BY v.detected_at DESC`,
    params
  );
  res.json(rows);
}));

// Run evaluation engine against a workflow, or (Epic 4, Feature 4.5) directly
// against an MCP server bound to its own policies.
router.post('/evaluate', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { workflow_id, server_id } = req.body;
  if (!workflow_id && !server_id) {
    return res.status(400).json({ error: 'workflow_id or server_id is required' });
  }

  if (server_id) {
    const violations = await evaluateMcpServer(server_id);
    return res.status(201).json({ server_id, violations_created: violations.length, violations });
  }

  const violations = await evaluateWorkflow(workflow_id);
  res.status(201).json({ workflow_id, violations_created: violations.length, violations });
}));

// EP-204-S7/S8 — a service reports an agent-identity security event it
// just detected (privilege escalation or confused deputy) at the moment it
// happens; there's no stored "current state" to re-evaluate later the way
// /evaluate's evaluators work. requirePermission('violation:resolve')
// passes for the internal-service-key callers this route actually expects
// (require-auth.js's requirePermission bypass) as well as a human admin
// investigating directly.
router.post('/agent-security-event', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { agent_id, agent_name, rule_type, message } = req.body;
  if (!agent_id) return res.status(400).json({ error: 'agent_id is required' });
  if (!rule_type) return res.status(400).json({ error: 'rule_type is required' });
  if (!message) return res.status(400).json({ error: 'message is required' });

  try {
    const violation = await recordAgentSecurityEvent({ agentId: agent_id, agentName: agent_name, ruleType: rule_type, message });
    res.status(201).json(violation);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}));

// Get violations summary counts grouped by workflow_id
router.get('/summary', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT workflow_id,
            COUNT(*)                                           AS total,
            COUNT(*) FILTER (WHERE status = 'open')            AS open,
            COUNT(*) FILTER (WHERE severity = 'critical')      AS critical,
            COUNT(*) FILTER (WHERE severity = 'high')          AS high,
            MAX(detected_at)                                   AS last_detected_at
       FROM violations
      GROUP BY workflow_id
      ORDER BY critical DESC, high DESC, total DESC`
  );
  res.json(rows);
}));

// GET /violations/:id/history — EP-103-S6's expandable timeline: every
// status transition this violation has ever had, oldest first (a timeline
// reads naturally start-to-finish, unlike the most-recent-first list above).
router.get('/:id/history', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM violation_history WHERE violation_id = $1 ORDER BY changed_at ASC',
    [req.params.id]
  );
  res.json(rows);
}));

// Generic status transition. Reopening (setting status back to 'open') is
// just another transition this endpoint permits alongside the others.
// 'waiver_requested'/'waived_temporarily' are deliberately NOT in
// VALID_STATUSES — see the waiver routes below for why.
router.patch('/:id/status', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { status, resolution_reason, evidence_id } = req.body;
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
  }

  const violation = await transitionViolation(req.params.id, status, {
    reason: resolution_reason, evidenceId: evidence_id, actor: req.user?.username,
  });
  if (!violation) return res.status(404).json({ error: 'Violation not found' });
  res.json(violation);
}));

// EP-105-S2 — dedicated lifecycle endpoints, thinner and more discoverable
// than the generic status one for the SPA's common-path actions.
router.patch('/:id/acknowledge', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const violation = await transitionViolation(req.params.id, 'acknowledged', { actor: req.user?.username });
  if (!violation) return res.status(404).json({ error: 'Violation not found' });
  res.json(violation);
}));

router.patch('/:id/remediating', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const violation = await transitionViolation(req.params.id, 'remediating', { actor: req.user?.username });
  if (!violation) return res.status(404).json({ error: 'Violation not found' });
  res.json(violation);
}));

router.patch('/:id/resolve', requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { resolution_reason, evidence_id } = req.body;
  const violation = await transitionViolation(req.params.id, 'resolved', {
    reason: resolution_reason, evidenceId: evidence_id, actor: req.user?.username,
  });
  if (!violation) return res.status(404).json({ error: 'Violation not found' });
  res.json(violation);
}));

// ── EP-104 — Waiver Management ──────────────────────────────────────────────

// POST /violations/:id/waivers — submit a waiver request. Moves the
// violation into 'waiver_requested' (a distinct state from 'open' — flags
// that someone is actively seeking an exception, not just that nobody has
// looked at it yet). Doesn't waive anything by itself; see PATCH
// /waivers/:id/approve.
router.post('/:id/waivers', requirePermission('waiver:grant'), wrap(async (req, res) => {
  const {
    policy_being_waived, justification, risk_acceptance, compensating_controls,
    scope, expires_at, renewal_limit, remediation_commitment, residual_risk,
  } = req.body;
  if (!justification) return res.status(400).json({ error: 'justification is required' });
  if (!expires_at) return res.status(400).json({ error: 'expires_at is required' });

  const requestedBy = req.user?.username ?? 'unknown';

  const violation = await transitionViolation(req.params.id, 'waiver_requested', {
    reason: 'Waiver requested', actor: requestedBy,
  });
  if (!violation) return res.status(404).json({ error: 'Violation not found' });

  const { rows: [waiver] } = await pool.query(
    `INSERT INTO waivers
       (violation_id, policy_being_waived, justification, risk_acceptance, compensating_controls,
        requested_by, scope, expires_at, renewal_limit, remediation_commitment, residual_risk)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      req.params.id, policy_being_waived ?? violation.policy_id, justification, risk_acceptance ?? null,
      compensating_controls ?? null, requestedBy, scope ?? null, expires_at, renewal_limit ?? 0,
      remediation_commitment ?? null, residual_risk ?? null,
    ]
  );
  res.status(201).json(waiver);
}));

// PATCH /waivers/:id/approve — approve or deny. Epic 4/EP-104: the approver
// must be a different actor from the requester — separation of duties on an
// exception request is the whole point of requiring approval at all.
router.patch('/waivers/:id/approve', requirePermission('waiver:grant'), wrap(async (req, res) => {
  const { decision } = req.body;
  if (!['approved', 'denied'].includes(decision)) {
    return res.status(400).json({ error: `decision must be one of: approved, denied` });
  }

  const { rows: [waiver] } = await pool.query('SELECT * FROM waivers WHERE id = $1', [req.params.id]);
  if (!waiver) return res.status(404).json({ error: 'Waiver not found' });
  if (waiver.status !== 'pending') return res.status(409).json({ error: `Waiver already ${waiver.status}` });

  const approver = req.user?.username ?? 'unknown';
  if (approver === waiver.requested_by) {
    return res.status(403).json({ error: 'The approver must be different from the requester' });
  }

  const { rows: [updated] } = await pool.query(
    `UPDATE waivers SET status = $1, approver = $2, decided_at = NOW(),
            valid_from = CASE WHEN $1 = 'approved' THEN NOW() ELSE valid_from END
      WHERE id = $3
  RETURNING *`,
    [decision, approver, req.params.id]
  );

  const newViolationStatus = decision === 'approved' ? 'waived_temporarily' : 'open';
  await transitionViolation(waiver.violation_id, newViolationStatus, {
    reason: decision === 'approved' ? `Waiver approved by ${approver}` : `Waiver denied by ${approver}`,
    actor: approver,
  });

  res.json(updated);
}));

// GET /waivers?status=&expiring_before=&violation_id= — EP-104-S6/S8: the
// admin waivers queue (pending approvals) and expiry-countdown list both
// read from this one endpoint.
router.get('/waivers', wrap(async (req, res) => {
  const { status, expiring_before, violation_id } = req.query;
  const conditions = [];
  const params = [];
  if (status)          { conditions.push(`status = $${params.push(status)}`); }
  if (expiring_before) { conditions.push(`expires_at <= $${params.push(expiring_before)}`); }
  if (violation_id)    { conditions.push(`violation_id = $${params.push(violation_id)}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT * FROM waivers ${where} ORDER BY expires_at ASC`,
    params
  );
  res.json(rows);
}));

export default router;
export { transitionViolation };
