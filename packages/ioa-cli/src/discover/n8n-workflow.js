import { apiGet, apiPost } from '../api-client.js';

// Resolves a developer-supplied target (a workflow's IOA id, its n8n_id, or
// its exact name) to an already-imported workflow row. If it isn't tracked
// yet but IS a real n8n workflow, imports it — this IS the confirmed
// "register/reconcile" internal sub-step every /ioa Check-mode command
// starts with; it's never a developer-facing verb of its own.
export async function resolveWorkflow({ baseUrl, token, target }) {
  // Already an IOA id? GET /workflows/:id accepts both id and n8n_id per
  // its own WHERE id = $1 OR n8n_id = $1 pattern used elsewhere in this
  // service (see workflow-governance-service's analysis.js /:id/analyze).
  const direct = await apiGet(baseUrl, token, `/api/workflow-governance/workflows/${encodeURIComponent(target)}`).catch(() => null);
  if (direct) return { workflow: direct, registered: 'already_tracked' };

  // Not found by id/n8n_id — search the tracked list by exact name.
  const tracked = await apiGet(baseUrl, token, '/api/workflow-governance/workflows?limit=200');
  const byName = tracked.find(w => w.name.toLowerCase() === target.toLowerCase());
  if (byName) {
    const full = await apiGet(baseUrl, token, `/api/workflow-governance/workflows/${byName.id}`);
    return { workflow: full, registered: 'already_tracked' };
  }

  // Not tracked at all — treat target as an n8n workflow id and import it.
  const imported = await apiPost(baseUrl, token, '/api/workflow-governance/workflows/import', { n8n_id: target });
  return { workflow: imported, registered: 'imported' };
}
