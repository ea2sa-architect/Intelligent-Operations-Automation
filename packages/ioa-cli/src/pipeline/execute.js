import { randomUUID } from 'node:crypto';
import { apiGet } from '../api-client.js';

const is404 = err => /\(404\)/.test(err.message);

// Distinct, visible states — never a silent skip, never a false pass, per
// the confirmed design. "not_eligible" covers both "never requested" and
// "workflow has no webhook" (the technical gate); "not_approved" covers a
// profile that exists but hasn't cleared review yet.
async function fetchEligibility({ baseUrl, token, workflowId }) {
  const profile = await apiGet(baseUrl, token, `/api/workflow-governance/workflows/${workflowId}/execution-profile`)
    .catch(err => { if (is404(err)) return null; throw err; });

  if (!profile) return { status: 'not_eligible', reason: 'no execution profile has been requested for this workflow' };
  if (profile.status !== 'approved') return { status: 'not_approved', reason: `execution profile is "${profile.status}", not approved`, profile_id: profile.id };
  if (!profile.webhook_url) return { status: 'not_eligible', reason: 'approved profile has no resolvable webhook URL' };
  return { status: 'approved', profile };
}

// Calls the workflow's own Webhook trigger URL directly with each approved
// scenario's payload — the only API-level way to trigger an n8n execution
// at all (confirmed: n8n's public API has no execute-workflow endpoint).
// Evidence is the real HTTP outcome of that call (status, latency) — not a
// speculative telemetry-correlation lookup, since whether a workflow
// forwards a correlation id into its own instrumentation is outside IOA's
// control for a workflow it doesn't own the internals of.
async function runScenario(webhookUrl, scenario) {
  const correlationId = `ioa-qa-${randomUUID()}`;
  const startedAt = Date.now();
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-IOA-Test-Correlation-Id': correlationId },
      body: JSON.stringify(scenario.payload_json ?? {}),
    });
    return {
      scenario: scenario.name, correlation_id: correlationId,
      http_status: res.status, latency_ms: Date.now() - startedAt,
      expected_outcome: scenario.expected_outcome ?? null,
    };
  } catch (err) {
    return { scenario: scenario.name, correlation_id: correlationId, error: err.message, latency_ms: Date.now() - startedAt };
  }
}

export async function runExecutionTier({ baseUrl, token, workflowId }) {
  const eligibility = await fetchEligibility({ baseUrl, token, workflowId });
  if (eligibility.status !== 'approved') {
    return { status: eligibility.status, reason: eligibility.reason, scenarios_run: 0, results: [] };
  }

  const scenarios = eligibility.profile.scenarios_json ?? [];
  const results = [];
  for (const scenario of scenarios) {
    // Sequential, not parallel — these are real side-effecting calls
    // against a real workflow; no reason to fire them concurrently.
    results.push(await runScenario(eligibility.profile.webhook_url, scenario));
  }
  return { status: 'tested', profile_id: eligibility.profile.id, scenarios_run: results.length, results };
}
