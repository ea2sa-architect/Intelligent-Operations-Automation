import { apiPost } from '../api-client.js';
import { runQa } from './run-qa.js';

// `ioa verify-release` — runs the full `ioa qa` pipeline (violations,
// coverage, anomalies, attack-paths, and the execution tier if the target
// has an approved profile) and freezes the result into a persisted
// governance.release_decisions row.
export async function runVerifyRelease({ baseUrl, token, target, releaseRef, decidedBy }) {
  const evidenceBundle = await runQa({ baseUrl, token, target });

  const decision = await apiPost(baseUrl, token, '/api/governance/release-decisions', {
    entity_type: evidenceBundle.target.type,
    entity_id: evidenceBundle.target.id,
    release_ref: releaseRef ?? null,
    evidence_bundle: evidenceBundle,
    decided_by: decidedBy,
  });

  return { evidenceBundle, decision };
}

export function exitCodeForDecision(decision) {
  return decision.decision.startsWith('certified') ? 0 : 1;
}
