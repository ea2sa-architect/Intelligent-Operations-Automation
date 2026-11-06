import { Router } from 'express';
import pool from '../../db.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(500).json({ error: err.message });
});

// EP-311-P0 — pure read of "what policies+rules apply to entity X", without
// the evaluation side effects POST /enforce carries (auto-bind, violation
// writes). Reuses the same policy_bindings JOIN policies query already
// duplicated inline in enforcement.js/rule-evaluator.js, and left-joins
// rule_evaluations so callers get "applicable" and "last evaluated" in one
// round trip — this is the coverage numerator/denominator the /ioa CLI needs.
router.get('/', wrap(async (req, res) => {
  const { entity_type, entity_id } = req.query;
  if (!entity_type || !entity_id) {
    return res.status(400).json({ error: 'entity_type and entity_id query params are required' });
  }

  const { rows: bindings } = await pool.query(
    `SELECT pb.policy_id, p.name AS policy_name, p.status AS policy_status, p.enforcement_mode
       FROM policy_bindings pb
       JOIN policies p ON p.id = pb.policy_id
      WHERE pb.entity_type = $1 AND pb.entity_id = $2
        AND (pb.effective_to IS NULL OR pb.effective_to > NOW())`,
    [entity_type, entity_id]
  );

  const policyIds = bindings.map(b => b.policy_id);
  const { rows: rules } = policyIds.length
    ? await pool.query(
        `SELECT pr.id, pr.policy_id, pr.rule_type, pr.severity, pr.enabled,
                re.last_result, re.evaluated_at
           FROM policy_rules pr
           LEFT JOIN rule_evaluations re
             ON re.rule_id = pr.id AND re.entity_type = $2 AND re.entity_id = $3
          WHERE pr.policy_id = ANY($1::uuid[]) AND pr.enabled = true`,
        [policyIds, entity_type, entity_id]
      )
    : { rows: [] };

  res.json({
    entity_type,
    entity_id,
    policies: bindings.map(b => ({
      ...b,
      rules: rules.filter(r => r.policy_id === b.policy_id),
    })),
  });
}));

export default router;
