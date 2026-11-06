import { Router } from 'express';
import pool from '../../db.js';
import { evaluateWorkflow, evaluateMcpServer, evaluateAiModel, evaluateZap } from '../lib/rule-evaluator.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

const ASSET_EVALUATORS = {
  workflow:   evaluateWorkflow,
  mcp_server: evaluateMcpServer,
  ai_model:   evaluateAiModel,
  zap:        evaluateZap,
};

// EP-203-S4 — "quarantine: full isolation, blocks enforcement pathway."
// Checked before any policy is evaluated, and deliberately not written to
// enforcement_events — those rows are policy decisions tied to a real
// policy_id (a NOT NULL FK), which a containment block isn't. The
// containment action itself was already recorded in
// governance.containment_log when it was taken (routes/containment.js);
// this is just this asset refusing to run at all while that's in effect.
const CONTAINMENT_STATE_QUERIES = {
  workflow:   'SELECT containment_state FROM workflow_governance.workflows WHERE id = $1',
  mcp_server: 'SELECT containment_state FROM mcp_governance.mcp_servers WHERE id = $1',
};

// EP-201-S11 — event history: every /enforce decision, filterable, most
// recent first. This is the "see every resulting governance decision" half
// of the Control Center — the mode selector (policies.js) is the other half.
router.get('/', wrap(async (req, res) => {
  const { policy_id, asset_type, asset_id, mode, outcome, limit } = req.query;
  const conditions = [];
  const params = [];
  if (policy_id)  { conditions.push(`ee.policy_id = $${params.push(policy_id)}`); }
  if (asset_type) { conditions.push(`ee.asset_type = $${params.push(asset_type)}`); }
  if (asset_id)   { conditions.push(`ee.asset_id = $${params.push(asset_id)}`); }
  if (mode)       { conditions.push(`ee.mode = $${params.push(mode)}`); }
  if (outcome)    { conditions.push(`ee.outcome = $${params.push(outcome)}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const cappedLimit = Math.min(Number(limit) || 100, 500);

  const { rows } = await pool.query(
    `SELECT ee.*, p.name AS policy_name
       FROM enforcement_events ee JOIN policies p ON p.id = ee.policy_id
       ${where}
      ORDER BY ee.created_at DESC
      LIMIT ${cappedLimit}`,
    params
  );
  res.json(rows);
}));

// EP-201-S11 — "enforcement activity count + block/warn ratio card"
router.get('/summary', wrap(async (_req, res) => {
  const { rows: [totals] } = await pool.query(
    `SELECT COUNT(*)                                   AS total,
            COUNT(*) FILTER (WHERE outcome = 'allow')   AS allow,
            COUNT(*) FILTER (WHERE outcome = 'warn')    AS warn,
            COUNT(*) FILTER (WHERE outcome = 'block')   AS block,
            COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h
       FROM enforcement_events`
  );
  const { rows: byPolicy } = await pool.query(
    `SELECT ee.policy_id, p.name AS policy_name, p.enforcement_mode,
            COUNT(*)                                 AS total,
            COUNT(*) FILTER (WHERE ee.outcome = 'warn')  AS warn,
            COUNT(*) FILTER (WHERE ee.outcome = 'block') AS block,
            MAX(ee.created_at)                        AS last_event_at
       FROM enforcement_events ee JOIN policies p ON p.id = ee.policy_id
      GROUP BY ee.policy_id, p.name, p.enforcement_mode
      ORDER BY block DESC, warn DESC, total DESC`
  );
  res.json({ ...totals, by_policy: byPolicy });
}));

// EP-201-S4/S10 — the single decision point Kong (MCP traffic, EP-201-S4/S5)
// and n8n (workflow execution, EP-201-S7/S8) both call before letting
// something through. Runs the same rule evaluation evaluateWorkflow/
// evaluateMcpServer already do — so violations stay current regardless of
// enforcement_mode — then asks each bound policy's enforcement_mode what to
// actually DO about what it found:
//   observe: outcome is always 'allow', even when a violation exists — the
//            violation and the event are still recorded, so switching a
//            policy to warn/enforce later is an informed decision, not a
//            guess.
//   warn:    a violation means outcome 'warn' — request passes through,
//            caller gets blocked_by=null but a warnings[] entry and an
//            X-IOA-Warning header.
//   enforce: a violation means outcome 'block' — 403, with the specific
//            policy_id + violation_id (EP-201-S5).
// Every bound policy gets exactly one governance.enforcement_events row per
// call, including a clean 'allow' with no violation — that's what makes
// "record every decision" true from the very first call, before Kong or n8n
// are wired up at all, and before any policy leaves 'observe'.
// EP-308-S4 / S2.8 (2026-10-08) — deliberately not requirePermission-gated.
// This is the decision point Kong and n8n call before letting traffic
// through (see the comment above), authenticated via INTERNAL_SERVICE_KEY
// like workflow-governance-service's callback/execution-event routes, not a
// browser session — there is no per-action permission that fits a
// machine-to-machine policy check. It used to say this was "still covered
// by the existing coarse write-permission check in require-auth.js" — that
// check was removed under EP-308-S4 itself (see require-auth.js's own
// changelog comment) and this route was missed when every other mutating
// route got its requirePermission call. Closed directly instead: only
// internal-service-key callers (req.user.isService) may call this route at
// all, matching the "machine-to-machine only" intent stated above rather
// than bolting on a permission that doesn't fit. See
// docs/baseline-assessment-2026-10.md finding F-01.
router.post('/', wrap(async (req, res) => {
  if (!req.user?.isService) {
    return res.status(403).json({ error: 'Internal service callers only' });
  }
  const { asset_type, asset_id, correlation_id, context } = req.body;
  const evaluate = ASSET_EVALUATORS[asset_type];
  if (!evaluate) {
    return res.status(400).json({ error: `asset_type must be one of: ${Object.keys(ASSET_EVALUATORS).join(', ')}` });
  }
  if (!asset_id) return res.status(400).json({ error: 'asset_id is required' });

  const containmentQuery = CONTAINMENT_STATE_QUERIES[asset_type];
  if (containmentQuery) {
    const { rows: [asset] } = await pool.query(containmentQuery, [asset_id]);
    if (asset && asset.containment_state !== 'active') {
      return res.status(403).json({
        decision: 'block', asset_type, asset_id, correlation_id: correlation_id ?? null,
        blocked_by: null, warnings: [], events: [],
        reason: 'contained', containment_state: asset.containment_state,
      });
    }
  }

  // EP-201-S13 — context carries request-scoped data an evaluator needs
  // that isn't part of the asset's own stored state (e.g. data_classification
  // for evaluateAiModel). evaluateWorkflow/evaluateMcpServer take a single
  // arg and simply ignore the second one.
  await evaluate(asset_id, context ?? {});

  const { rows: bindings } = await pool.query(
    `SELECT pb.policy_id, p.name AS policy_name, p.enforcement_mode
       FROM policy_bindings pb JOIN policies p ON p.id = pb.policy_id
      WHERE pb.entity_type = $1 AND pb.entity_id = $2
        AND (pb.effective_to IS NULL OR pb.effective_to > NOW())`,
    [asset_type, asset_id]
  );

  const events = [];
  let blockedBy = null;
  const warnings = [];

  for (const binding of bindings) {
    const { rows: violations } = await pool.query(
      `SELECT id, message FROM violations
        WHERE entity_type = $1 AND entity_id = $2 AND policy_id = $3 AND status IN ('open', 'reopened')
        ORDER BY detected_at DESC`,
      [asset_type, asset_id, binding.policy_id]
    );
    const violation = violations[0] ?? null;

    let outcome = 'allow';
    if (violation) {
      if (binding.enforcement_mode === 'enforce') outcome = 'block';
      else if (binding.enforcement_mode === 'warn') outcome = 'warn';
      // observe: outcome stays 'allow' — the violation is still recorded below
    }

    const { rows: [event] } = await pool.query(
      `INSERT INTO enforcement_events
         (policy_id, violation_id, asset_type, asset_id, mode, outcome, message, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [binding.policy_id, violation?.id ?? null, asset_type, asset_id, binding.enforcement_mode,
       outcome, violation?.message ?? null, correlation_id ?? null]
    );
    events.push({ ...event, policy_name: binding.policy_name });

    if (outcome === 'block' && !blockedBy) {
      blockedBy = { policy_id: binding.policy_id, policy_name: binding.policy_name, violation_id: violation.id, message: violation.message };
    }
    if (outcome === 'warn') {
      warnings.push({ policy_id: binding.policy_id, policy_name: binding.policy_name, violation_id: violation.id, message: violation.message });
    }
  }

  const decision = blockedBy ? 'block' : warnings.length > 0 ? 'warn' : 'allow';

  if (decision === 'warn') {
    res.set('X-IOA-Warning', warnings.map(w => w.policy_name).join('; '));
  }

  res.status(decision === 'block' ? 403 : 200).json({
    decision, asset_type, asset_id, correlation_id: correlation_id ?? null,
    blocked_by: blockedBy, warnings, events,
  });
}));

export default router;
