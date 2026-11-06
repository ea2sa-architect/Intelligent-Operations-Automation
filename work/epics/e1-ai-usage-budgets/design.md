---
epic_id: "E1"
grounded_in: "Gemba of db/migrations/ai_inference/{001,002,003}*.sql, services/ai-inference-service/src/routes/inference.js, src/lib/{governance-client,telemetry-client}.js, services/mcp-governance-service/src/lib/escalation-client.js, services/governance-service/src/lib/rule-evaluator.js, web/src/pages/RoiIntelligence.jsx"
---

# Epic Design: AI Usage Budgets

## Affected Surface (Gemba)

| Module/File | Current State | Changes |
|-------------|---------------|---------|
| `db/migrations/ai_inference/004_usage_budgets.sql` (new) | — | New `usage_budgets` table |
| `services/ai-inference-service/src/lib/spend-check.js` (new) | — | Computes cumulative spend for a scope+period from `inference_requests`, compares against bound budget(s) |
| `services/ai-inference-service/src/lib/escalation-client.js` (new) | Doesn't exist — this service has no escalation client today, unlike mcp-governance-service | `createIncident()`, same fail-soft fetch-wrapper convention as `mcp-governance-service`'s |
| `services/ai-inference-service/src/routes/inference.js` `POST /` (line ~78) | Calls `governanceClient.checkEnforcement()` only — asset-level check, cost of *this* request unknown yet | Add a spend-check call after the existing enforcement check: gates on **historical** spend for the request's scope, since this request's own cost isn't known until completion |
| `services/ai-inference-service/src/routes/inference.js` `PUT /:id` (line ~133) | Persists `estimated_cost_usd`/tokens, emits telemetry — no budget awareness | After persisting, re-check the now-updated scope's spend; if this completion just crossed a bound budget's limit, call escalation-client (this is the *first* point the breach is knowable, not `POST /`) |
| `services/ai-inference-service/src/routes/budgets.js` (new) | — | CRUD for `usage_budgets`, mounted at `/budgets` |
| `web/src/pages/admin/BudgetAdmin.jsx` (new) | — | Follows `TagAdmin.jsx`/`WaiverAdmin.jsx` pattern |
| `web/src/lib/api.js` | 19 client exports, no `budgets` | Add `budgets` client (list/create/update/archive) |
| `web/src/pages/Telemetry.jsx` (SHOULD, S1.5) | Recharts line chart, no reference lines | Optional budget-limit reference line, reusing existing `metric_name=estimated_cost_usd` query |
| `web/src/pages/RoiIntelligence.jsx` | Fully built (EP-102), unrelated tool | **Not touched** — confirmed out of scope |
| `governance/architecture/modules/ai-inference-service.md`, `escalation-service.md` | Written this session, don't mention budgets | Update after implementation (`/rai-docs-update`) |

## Target Components

| Component | Responsibility | Key Interface |
|-----------|---------------|----------------|
| `usage_budgets` (table) | Budget definition: scope, period, limit, mode | `{id, scope_type, scope_value, period, limit_usd, mode, status}` |
| `spend-check.js` | Aggregate spend, compare to limit | `checkBudget({scopeType, scopeValue}) → {status: 'ok'\|'warn'\|'breach', budget, spent, limit}` |
| `escalation-client.js` (ai-inference-service) | Report budget breaches as incidents | `createIncident({title, severity, contextJson}) → incident \| null` (fail-soft, mirrors mcp-governance-service's) |
| `routes/budgets.js` | Budget CRUD | `GET/POST /budgets`, `PUT/DELETE /budgets/:id` |
| `BudgetAdmin.jsx` | Budget management UI | Same shape as `WaiverAdmin.jsx`: table + create/edit modal |

## Key Contracts

```js
// spend-check.js
async function checkBudget({ scopeType, scopeValue }) {
  // scopeType: 'model_id' | 'user_id' | 'service_id' | 'workflow_id'
  // Exact-match against inference_requests' existing free-text columns —
  // no new entity registry (see scope.md — Risks).
  // Returns 'ok' if no budget is bound to this scope (budgets are opt-in).
}
// → { status: 'ok' | 'warn' | 'breach', budget: {...} | null, spent_usd: number, limit_usd: number | null }

// POST /budgets  (requirePermission('inference:manage'), same guard as other mutating routes here)
// body: { scope_type, scope_value, period: 'daily'|'monthly', limit_usd, mode: 'soft'|'hard' }
// → 201 { id, scope_type, scope_value, period, limit_usd, mode, status: 'active' }
```

**`POST /` (inference.js) insertion point** — after the existing
`governanceClient.checkEnforcement()` block, before the `INSERT`:

```js
const budgetCheck = await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: user_id });
// also check model_id and workflow_id scopes if bound — first breach wins
if (budgetCheck.status === 'breach' && budgetCheck.budget.mode === 'hard') {
  return res.status(403).json({ error: 'Blocked by usage budget', budget: budgetCheck.budget });
}
// 'warn' or 'breach' with mode 'soft': proceed, but see PUT /:id for escalation
```

**`PUT /:id` insertion point** — after the `estimated_cost_usd` UPDATE, only
on terminal status (mirrors the existing telemetry-event gating):

```js
if (request.status === 'completed' || request.status === 'failed') {
  const check = await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: request.user_id });
  if (check.status === 'breach') {
    await escalationClient.createIncident({
      title: `Usage budget exceeded: ${check.budget.scope_type}=${check.budget.scope_value}`,
      severity: check.budget.mode === 'hard' ? 'high' : 'medium',
      contextJson: { budget_id: check.budget.id, spent_usd: check.spent_usd, limit_usd: check.limit_usd },
    });
  }
}
```

Per ADR-002, both call sites wrap `spendCheck.checkBudget()` in the same
fail-open try/catch every other cross-service client here uses — a
spend-check error never blocks or fails the inference request itself.

## Migration Path

Greenfield — no existing budget concept to migrate from. `usage_budgets`
starts empty; budgets are opt-in per scope, so shipping this with zero
budgets defined changes nothing about current behavior until an admin
creates one.
