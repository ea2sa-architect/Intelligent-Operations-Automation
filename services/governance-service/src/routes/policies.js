import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';
import { UNEVALUATED_RULE_TYPES } from '../lib/unevaluated-rules.js';
import { validateRuleConfig, RULE_NAME_RE } from '../lib/rule-config.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// Rule types the catalog offers but nothing evaluates (see rule-evaluator.js).
// Derived from the policy's current rules on every read — never stored — so
// it cannot go stale when a rule is added or removed in the UI.
const UNEVALUATED_SQL = `ARRAY[${UNEVALUATED_RULE_TYPES.map(t => `'${t}'`).join(', ')}]::text[]`;

// Warnings returned alongside a status/mode change that makes a policy "live".
// Non-blocking (the ioa CLI drives these same routes) but never silent.
async function unevaluatedWarnings(policyId) {
  const result = await pool.query(
    'SELECT DISTINCT rule_type FROM policy_rules WHERE policy_id = $1 AND enabled = true AND rule_type = ANY($2::text[])',
    [policyId, UNEVALUATED_RULE_TYPES]
  );
  const types = (result?.rows ?? []).map(r => r.rule_type);
  return types.length
    ? [`This policy contains rules the platform does not evaluate yet (${types.join(', ')}): activating or enforcing it will not protect against what those rules describe.`]
    : [];
}

// List policies — includes open violation count per policy
// Optional query params: status, workflow_id (filters by metadata_json->>'workflow_id')
router.get('/', wrap(async (req, res) => {
  const { status, workflow_id } = req.query;
  const base = `
    SELECT p.*,
           COUNT(v.id) FILTER (WHERE v.status = 'open') AS open_violations,
           COALESCE((SELECT array_agg(DISTINCT r.rule_type) FROM policy_rules r
                      WHERE r.policy_id = p.id AND r.enabled AND r.rule_type = ANY(${UNEVALUATED_SQL})), '{}') AS unevaluated_rule_types
      FROM policies p
      LEFT JOIN violations v ON v.policy_id = p.id
  `;
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  if (workflow_id) {
    params.push(workflow_id);
    conditions.push(`p.metadata_json->>'workflow_id' = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')} ` : '';
  const { rows } = await pool.query(
    base + where + 'GROUP BY p.id ORDER BY p.created_at DESC',
    params
  );
  res.json(rows);
}));

// Get one policy with rules, bindings, and violation summary
router.get('/:id', wrap(async (req, res) => {
  const { rows: [policy] } = await pool.query('SELECT * FROM policies WHERE id = $1', [req.params.id]);
  if (!policy) return res.status(404).json({ error: 'Policy not found' });

  const [{ rows: rules }, { rows: bindings }, { rows: violationSummary }] = await Promise.all([
    pool.query('SELECT * FROM policy_rules WHERE policy_id = $1 ORDER BY priority', [req.params.id]),
    pool.query('SELECT * FROM policy_bindings WHERE policy_id = $1 ORDER BY created_at DESC', [req.params.id]),
    pool.query(
      `SELECT COUNT(*) FILTER (WHERE status = 'open')     AS open,
              COUNT(*) FILTER (WHERE status = 'acknowledged') AS acknowledged,
              COUNT(*) FILTER (WHERE status = 'resolved')     AS resolved,
              COUNT(*)                                          AS total
         FROM violations WHERE policy_id = $1`,
      [req.params.id]
    ),
  ]);
  const unevaluated = [...new Set(rules.filter(r => r.enabled && UNEVALUATED_RULE_TYPES.includes(r.rule_type)).map(r => r.rule_type))];
  res.json({ ...policy, rules, bindings, violations: violationSummary[0], unevaluated_rule_types: unevaluated });
}));

// Create policy
router.post('/', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { name, description, status = 'draft', metadata_json } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  const { rows: [policy] } = await pool.query(
    'INSERT INTO policies (name, description, status, metadata_json) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, description ?? null, status, metadata_json ? JSON.stringify(metadata_json) : null]
  );
  res.status(201).json(policy);
}));

// Update policy metadata
router.put('/:id', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { name, description, metadata_json } = req.body;
  const { rows: [policy] } = await pool.query(
    `UPDATE policies
        SET name          = COALESCE($1, name),
            description   = COALESCE($2, description),
            metadata_json = COALESCE($3, metadata_json),
            updated_at    = NOW()
      WHERE id = $4
  RETURNING *`,
    [name ?? null, description ?? null, metadata_json ? JSON.stringify(metadata_json) : null, req.params.id]
  );
  if (!policy) return res.status(404).json({ error: 'Policy not found' });
  res.json(policy);
}));

// Change status + snapshot version
router.patch('/:id/status', requirePermission('policy:edit'), wrap(async (req, res) => {
  const VALID = ['draft', 'active', 'inactive', 'archived'];
  const { status } = req.body;
  if (!VALID.includes(status)) return res.status(400).json({ error: `status must be one of: ${VALID.join(', ')}` });

  const { rows: [policy] } = await pool.query(
    'UPDATE policies SET status = $1, version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [status, req.params.id]
  );
  if (!policy) return res.status(404).json({ error: 'Policy not found' });

  await pool.query(
    'INSERT INTO policy_versions (policy_id, version, snapshot_json) VALUES ($1, $2, $3)',
    [policy.id, policy.version, policy]
  );
  const warnings = status === 'active' ? await unevaluatedWarnings(policy.id) : [];
  res.json(warnings.length ? { ...policy, warnings } : policy);
}));

// EP-201-S2 — enforcement_mode is deliberately a separate lever from
// draft/active/inactive/archived (/:id/status above): a policy can be
// 'active' and evaluated for weeks in 'observe' before an operator ever
// flips it to 'warn' or 'enforce'. Same version-snapshot audit trail as
// /:id/status, since flipping a policy from warn to enforce is exactly the
// kind of change that must be reconstructable later. No dedicated "admin"
// role exists yet (see AUTH-502/503 in CLAUDE.md) — gated by the same
// coarse write permission every other mutating route already requires.
router.patch('/:id/enforcement-mode', requirePermission('policy:edit'), wrap(async (req, res) => {
  const VALID = ['observe', 'warn', 'enforce'];
  const { enforcement_mode } = req.body;
  if (!VALID.includes(enforcement_mode)) {
    return res.status(400).json({ error: `enforcement_mode must be one of: ${VALID.join(', ')}` });
  }

  const { rows: [policy] } = await pool.query(
    'UPDATE policies SET enforcement_mode = $1, version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING *',
    [enforcement_mode, req.params.id]
  );
  if (!policy) return res.status(404).json({ error: 'Policy not found' });

  await pool.query(
    'INSERT INTO policy_versions (policy_id, version, snapshot_json) VALUES ($1, $2, $3)',
    [policy.id, policy.version, policy]
  );
  const warnings = enforcement_mode !== 'observe' ? await unevaluatedWarnings(policy.id) : [];
  res.json(warnings.length ? { ...policy, warnings } : policy);
}));

// Delete policy
router.delete('/:id', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM policies WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Policy not found' });
  res.status(204).end();
}));

// --- Rules ---

router.post('/:id/rules', requirePermission('policy:edit'), wrap(async (req, res) => {
  const {
    // typed rule fields
    name, rule_type, config_json, severity = 'medium', enabled = true,
    // legacy fields (still accepted for backward compat)
    condition_json, action,
    priority = 0,
  } = req.body;

  const isTyped  = !!rule_type;
  const isLegacy = !!(condition_json && action);
  if (!isTyped && !isLegacy) {
    return res.status(400).json({ error: 'Either rule_type or (condition_json + action) is required' });
  }

  // Optional rule name (the stable key policy bundles use for diffs/re-imports)
  if (name !== undefined && name !== null && !(typeof name === 'string' && RULE_NAME_RE.test(name))) {
    return res.status(400).json({ error: 'name must be 1-128 characters: letters, digits, spaces and _ . : / ( ) -' });
  }

  // Validate rule_type exists in catalog, and that config_json fits its schema —
  // the same check policy bundle import applies, so a rule created here is no
  // less safe than an imported one.
  if (isTyped) {
    const { rows: [schema] } = await pool.query(
      'SELECT type, schema_json FROM rule_schemas WHERE type = $1', [rule_type]
    );
    if (!schema) return res.status(400).json({ error: `Unknown rule_type: ${rule_type}` });
    const problems = validateRuleConfig(schema.schema_json, config_json ?? {});
    if (problems.length) {
      return res.status(400).json({
        error: `Invalid rule configuration: ${problems.map(p => `${p.path} ${p.message}`).join('; ')}`,
        details: problems,
      });
    }
  }

  const VALID_SEV = ['low', 'medium', 'high', 'critical'];
  if (!VALID_SEV.includes(severity)) {
    return res.status(400).json({ error: `severity must be one of: ${VALID_SEV.join(', ')}` });
  }

  let rule;
  try {
    ({ rows: [rule] } = await pool.query(
      `INSERT INTO policy_rules
         (policy_id, name, rule_type, config_json, severity, enabled, condition_json, action, priority)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        req.params.id,
        name        ?? null,
        rule_type   ?? null,
        config_json ? JSON.stringify(config_json) : '{}',
        severity,
        enabled,
        condition_json ? JSON.stringify(condition_json) : null,
        action ?? null,
        priority,
      ]
    ));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `A rule named "${name}" already exists in this policy` });
    throw err;
  }
  res.status(201).json(rule);
}));

router.delete('/:id/rules/:ruleId', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM policy_rules WHERE id = $1 AND policy_id = $2',
    [req.params.ruleId, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Rule not found' });
  res.status(204).end();
}));

// --- Bindings ---

router.get('/:id/bindings', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM policy_bindings WHERE policy_id = $1 ORDER BY created_at DESC',
    [req.params.id]
  );
  res.json(rows);
}));

router.post('/:id/bindings', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { entity_type, entity_id, effective_from, effective_to } = req.body;
  if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id are required' });

  const { rows: [binding] } = await pool.query(
    `INSERT INTO policy_bindings (policy_id, entity_type, entity_id, effective_from, effective_to)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (policy_id, entity_type, entity_id)
       DO UPDATE SET effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to
     RETURNING *`,
    [req.params.id, entity_type, entity_id, effective_from ?? new Date(), effective_to ?? null]
  );
  res.status(201).json(binding);
}));

router.delete('/:id/bindings/:bindingId', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM policy_bindings WHERE id = $1 AND policy_id = $2',
    [req.params.bindingId, req.params.id]
  );
  if (!rowCount) return res.status(404).json({ error: 'Binding not found' });
  res.status(204).end();
}));

export default router;
