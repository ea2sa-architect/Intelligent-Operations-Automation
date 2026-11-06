import { Router } from 'express';
import pool from '../../db.js';
import credentialScanner from '../lib/credential-scanner.js';
import redactionConfig from '../lib/redaction-config.js';
import telemetryClient from '../lib/telemetry-client.js';
import governanceClient from '../lib/governance-client.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const OUTCOMES = ['success', 'failure', 'denied'];

// POST /tools/:id/invocation-event — Epic 6, Feature 6.1. Records one MCP
// tool invocation, reusing telemetry-service's existing generic metrics
// pattern rather than a dedicated hypertable. Feature 6.2's redaction runs
// on arguments/output before anything is forwarded — the raw payload never
// leaves this function. Must be registered before tools.js's /tools/:id
// routes or Express's wildcard would swallow this path as id='invocation-event'
// under the wrong id segment — mounted at root here, so registration order
// in routes/index.js matters (see that file's comment on fallthrough-by-specificity).
// EP-308-S4 — telemetry:write, same permission as telemetry-service's own
// ingestion route: this is an instrumented MCP client reporting an
// invocation, not a registry-maintenance action.
router.post('/tools/:id/invocation-event', requirePermission('telemetry:write'), wrap(async (req, res) => {
  const {
    correlation_id, workflow_id, client_id, client_name, outcome,
    duration_ms, started_at, completed_at, arguments: toolArguments, output,
    acting_for_user_id,
  } = req.body;

  if (!OUTCOMES.includes(outcome)) {
    return res.status(400).json({ error: `outcome must be one of: ${OUTCOMES.join(', ')}` });
  }

  const { rows: [tool] } = await pool.query(
    'SELECT id, name, server_id FROM mcp_governance.mcp_tools WHERE id = $1', [req.params.id]
  );
  if (!tool) return res.status(404).json({ error: 'Tool not found' });

  // EP-204-S8 — confused deputy: this invocation is authenticated by an
  // agent-issued token (req.user.delegationId set), and the caller asserts
  // it's acting on behalf of a specific user. If that user isn't the one
  // who actually delegated this authority, the agent is being used to
  // service a different principal than the one who granted it — report it,
  // but never block the invocation on this check alone (an unreachable
  // auth-service or a caller that just doesn't pass acting_for_user_id must
  // not turn into a false block on ordinary agent activity).
  if (acting_for_user_id && req.user?.delegationId) {
    try {
      const { rows: [delegation] } = await pool.query(
        'SELECT initiating_user_id FROM auth.delegation_records WHERE id = $1',
        [req.user.delegationId]
      );
      if (delegation && delegation.initiating_user_id && delegation.initiating_user_id !== acting_for_user_id) {
        await governanceClient.reportAgentConfusedDeputy({
          agentId: req.user.id.startsWith('agent:') ? req.user.id.slice('agent:'.length) : req.user.id,
          agentName: req.user.username,
          delegatedForUserId: delegation.initiating_user_id,
          actingForUserId: acting_for_user_id,
        });
      }
    } catch (err) {
      console.error('[telemetry] confused-deputy check failed:', err.message);
    }
  }

  // EP-102-S3 — an explicit correlation_id in the body wins (a client that
  // already knows its chain id), otherwise fall back to this request's own
  // id from the correlationId middleware (req.correlationId — either
  // forwarded via x-correlation-id by whatever called this route, or freshly
  // minted). Previously fell back to a disconnected crypto.randomUUID()
  // here, which is exactly the "every invocation gets a locally-minted,
  // unlinked id" gap this epic closes — nothing upstream could ever join a
  // workflow's chain to its MCP tool invocations.
  const finalCorrelationId = correlation_id || req.correlationId;
  const extraPatterns = await redactionConfig.loadEnabledExtraPatterns();

  const argsResult   = credentialScanner.redactFieldsOrWithhold({ arguments: toolArguments ?? null }, extraPatterns);
  const outputResult = credentialScanner.redactFieldsOrWithhold({ output: output ?? null }, extraPatterns);

  await telemetryClient.recordInvocationEvent({
    correlationId: finalCorrelationId,
    serverId: tool.server_id,
    toolId: tool.id,
    toolName: tool.name,
    clientId: client_id ?? null,
    clientName: client_name ?? null,
    workflowId: workflow_id ?? null,
    // EP-204-S5 — undefined for every caller except an agent-issued token.
    delegationId: req.user?.delegationId ?? null,
    outcome,
    durationMs: duration_ms ?? null,
    startedAt: started_at ?? null,
    completedAt: completed_at ?? null,
    redactedArguments: argsResult.redactedFields.arguments,
    redactedOutput: outputResult.redactedFields.output,
    redactionApplied: argsResult.findings.length > 0 || outputResult.findings.length > 0,
    redactionFailed: argsResult.redactionFailed || outputResult.redactionFailed,
  });

  res.status(202).json({ recorded: true, correlation_id: finalCorrelationId });
}));

// GET /telemetry/mcp-invocations — query by correlation ID, server, tool,
// client, workflow, and time range (Feature 6.1's API-consumer story).
router.get('/telemetry/mcp-invocations', wrap(async (req, res) => {
  const invocations = await telemetryClient.queryInvocations(req.query);
  res.json(invocations);
}));

export default router;
