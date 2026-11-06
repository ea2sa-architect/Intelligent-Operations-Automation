// E7-S1.1 — budget spend-check. Computation only; wiring this into
// inference.js's routes (enforcement) and escalation-client.js (breach
// reporting) are separate stories (S1.2, S1.3) — see
// work/epics/e1-ai-usage-budgets/design.md.

import pool from '../../db.js';

const SCOPE_COLUMNS = Object.freeze({
  model_id: 'model_id',
  user_id: 'user_id',
  service_id: 'service_id',
  workflow_id: 'workflow_id',
});

// D1 — calendar windows, not rolling. Matches the "budget resets" mental
// model and this codebase's existing calendar-based convention
// (audit-service's monthly range partitioning).
function computePeriodStart(period, now = new Date()) {
  if (period === 'daily') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (period === 'monthly') {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }
  throw new Error(`Invalid period: ${period}`);
}

// D2 — allowlist dispatch, not string interpolation. scope_type will
// eventually be admin-supplied (S1.4's CRUD page); this must never let an
// arbitrary string reach a SQL column reference.
function resolveScopeColumn(scopeType) {
  const column = SCOPE_COLUMNS[scopeType];
  if (!column) {
    throw new Error(`Invalid scope_type: ${scopeType}`);
  }
  return column;
}

// warn/breach thresholds: 80% / 100% of limit_usd — see s1.1-design.md AC3.
const WARN_THRESHOLD = 0.8;

async function checkBudget({ scopeType, scopeValue }) {
  const column = resolveScopeColumn(scopeType); // throws before any query if invalid

  const { rows: [budget] } = await pool.query(
    `SELECT * FROM usage_budgets
      WHERE scope_type = $1 AND scope_value = $2 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [scopeType, scopeValue]
  );

  if (!budget) {
    return { status: 'ok', budget: null, spent_usd: 0, limit_usd: null };
  }

  const periodStart = computePeriodStart(budget.period);

  const { rows: [{ spent }] } = await pool.query(
    `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS spent
       FROM inference_requests
      WHERE ${column} = $1
        AND created_at >= $2
        AND estimated_cost_usd IS NOT NULL`,
    [scopeValue, periodStart]
  );

  // node-postgres returns NUMERIC columns as strings — must parse before
  // any >= comparison, or every threshold check below silently does
  // string comparison instead of numeric.
  const spent_usd = Number(spent);
  const limit_usd = Number(budget.limit_usd);

  let status = 'ok';
  if (spent_usd >= limit_usd) status = 'breach';
  else if (spent_usd >= limit_usd * WARN_THRESHOLD) status = 'warn';

  return { status, budget, spent_usd, limit_usd };
}

export { computePeriodStart, resolveScopeColumn };
export default { checkBudget };
