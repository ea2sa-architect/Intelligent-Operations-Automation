/**
 * Rule Evaluation Engine
 *
 * Evaluates a workflow against all typed rules in its bound policies.
 * Cross-schema queries use fully-qualified table names since search_path = governance.
 */

import pool from '../../db.js';
import { UNEVALUATED_RULE_TYPES } from './unevaluated-rules.js';

// ── Per-type evaluators ─────────────────────────────────────────────────────
// Each receives (workflow, nodes, piiRows, config) and returns violation messages[].

function evalPiiDetection(workflow, nodes, piiRows, config) {
  const targets = config.inspection_targets ?? [];
  const fields  = (config.sensitive_fields ?? []).map(f => f.toLowerCase());
  const msgs = [];

  for (const row of piiRows) {
    const typeMatch  = fields.length === 0 || fields.includes(row.pii_type?.toLowerCase());
    const targetMatch = targets.length === 0 ||
      targets.some(t => row.field_location?.includes(t) || row.node_name?.includes(t));
    if (typeMatch && targetMatch) {
      msgs.push(`PII type "${row.pii_type}" exposed in node "${row.node_name}" (${row.field_location ?? 'unknown location'})`);
    }
  }
  return msgs;
}

function evalAiProviderDetection(workflow, nodes, _pii, config) {
  const allowed     = (config.allowed_providers ?? []).map(p => p.toLowerCase());
  const blockUnknown = config.block_unknown !== 'false';
  const aiNodes     = nodes.filter(n => n.governance_type === 'ai_inference');
  const msgs = [];

  for (const node of aiNodes) {
    const params   = node.parameters_json ?? {};
    const provider = (params.provider ?? params.model ?? '').toLowerCase();
    if (!provider && blockUnknown) {
      msgs.push(`AI node "${node.node_name}" has no identifiable provider`);
    } else if (provider && allowed.length > 0 && !allowed.some(a => provider.includes(a))) {
      msgs.push(`AI node "${node.node_name}" uses unapproved provider "${provider}"`);
    }
  }
  return msgs;
}

function evalDataClassification(workflow, _nodes, _pii, config) {
  const required = (config.required_tags ?? []).map(t => t.toLowerCase());
  if (required.length === 0) return [];

  const wfTags = (workflow.tags ?? []).map(t => t.toLowerCase());
  const missing = required.filter(t => !wfTags.includes(t));
  if (missing.length === 0) return [];
  return [`Workflow is missing required classification tags: ${missing.join(', ')}`];
}

function evalApprovalRequirement(workflow, nodes, _pii, config) {
  const hasApproval = nodes.some(n => n.governance_type === 'approval');
  if (hasApproval) return [];
  const roles = config.approver_roles?.join(', ') ?? 'compliance team';
  return [`Workflow requires human approval (${roles}) but has no approval node`];
}

function evalEncryptionEnforcement(workflow, nodes, _pii, config) {
  const exempt  = (config.exempt_domains ?? []).map(d => d.toLowerCase());
  const httpNodes = nodes.filter(n => n.governance_type === 'http');
  const msgs = [];

  for (const node of httpNodes) {
    const url = node.parameters_json?.url ?? node.parameters_json?.endpoint ?? '';
    if (!url) continue;
    const isExempt = exempt.some(d => url.toLowerCase().includes(d));
    if (!isExempt && !url.toLowerCase().startsWith('https://')) {
      msgs.push(`HTTP node "${node.node_name}" uses non-HTTPS URL: ${url}`);
    }
  }
  return msgs;
}

function evalTokenLimit(workflow, nodes, _pii, config) {
  const maxInput  = parseInt(config.max_input_tokens ?? '0', 10);
  const maxOutput = parseInt(config.max_output_tokens ?? '0', 10);
  const scope     = (config.model_scope ?? []).map(m => m.toLowerCase());
  const aiNodes   = nodes.filter(n => n.governance_type === 'ai_inference');
  const msgs = [];

  for (const node of aiNodes) {
    const params    = node.parameters_json ?? {};
    const model     = (params.model ?? '').toLowerCase();
    const inScope   = scope.length === 0 || scope.some(s => model.includes(s));
    if (!inScope) continue;

    const nodeMax = parseInt(params.maxTokens ?? params.max_tokens ?? params.maxOutputTokens ?? '0', 10);
    if (maxOutput > 0 && nodeMax > 0 && nodeMax > maxOutput) {
      msgs.push(`AI node "${node.node_name}" allows ${nodeMax} output tokens, exceeding limit of ${maxOutput}`);
    }
    if (maxOutput > 0 && nodeMax === 0) {
      msgs.push(`AI node "${node.node_name}" has no token limit configured (policy requires max ${maxOutput})`);
    }
  }
  return msgs;
}

function evalModelAllowlist(workflow, nodes, _pii, config) {
  const allowed     = (config.allowed_models ?? []).map(m => m.toLowerCase());
  const blockUnlisted = config.block_unlisted !== 'false';
  if (!blockUnlisted || allowed.length === 0) return [];

  const aiNodes = nodes.filter(n => n.governance_type === 'ai_inference');
  const msgs = [];

  for (const node of aiNodes) {
    const model = (node.parameters_json?.model ?? '').toLowerCase();
    if (!model) {
      msgs.push(`AI node "${node.node_name}" has no model specified`);
    } else if (!allowed.some(a => model.includes(a))) {
      msgs.push(`AI node "${node.node_name}" uses model "${model}" which is not on the allowlist`);
    }
  }
  return msgs;
}

function evalWorkflowScope(workflow, _nodes, _pii, config) {
  const allowedProjects = (config.allowed_projects ?? []).map(p => p.toLowerCase());
  if (allowedProjects.length === 0) return [];

  const projectId = (workflow.project_id ?? '').toLowerCase();
  const projectName = (workflow.project_name ?? '').toLowerCase();
  const match = allowedProjects.some(p => p === projectId || p === projectName);
  if (match) return [];
  return [`Workflow belongs to project "${workflow.project_name ?? workflow.project_id ?? 'unknown'}" which is not in the allowed scope`];
}

function evalOutboundDomain(workflow, nodes, _pii, config) {
  const allowed       = (config.allowed_domains ?? []).map(d => d.toLowerCase());
  const blockUnlisted = config.block_unlisted !== 'false';
  const exemptPrivate = config.exempt_private_ranges !== 'false';
  if (!blockUnlisted || allowed.length === 0) return [];

  const PRIVATE = ['localhost', '127.', '10.', '172.16.', '192.168.'];
  const httpNodes = nodes.filter(n => n.governance_type === 'http');
  const msgs = [];

  for (const node of httpNodes) {
    const url = node.parameters_json?.url ?? node.parameters_json?.endpoint ?? '';
    if (!url) continue;
    let hostname = '';
    try { hostname = new URL(url).hostname.toLowerCase(); } catch { continue; }
    if (exemptPrivate && PRIVATE.some(p => hostname.startsWith(p))) continue;
    if (!allowed.some(a => hostname === a || hostname.endsWith('.' + a))) {
      msgs.push(`HTTP node "${node.node_name}" calls unapproved domain "${hostname}"`);
    }
  }
  return msgs;
}

// Unregistered is "unassessed", not "low risk" — same principle IOA already
// applies to governance_posture. Takes a 5th arg (mcpRefs) that plain
// workflow evaluators above don't declare; JS ignores the extra call
// argument for them, so this doesn't require touching their signatures.
function evalMcpServerRegistration(_workflow, _nodes, _pii, config, mcpRefs = []) {
  const requireApproved = config.require_approved_status === 'true';
  const msgs = [];

  for (const ref of mcpRefs) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    if (!ref.registered) {
      msgs.push(`Workflow references unregistered MCP server "${label}" (node "${ref.node_name}") — unassessed, not low-risk`);
    } else if (requireApproved && ref.server_status !== 'approved') {
      msgs.push(`Workflow references MCP server "${label}" (node "${ref.node_name}") which is registered but not yet approved (status: ${ref.server_status})`);
    }
  }
  return msgs;
}

// A workflow's MCP-client node can invoke any tool its server exposes at
// runtime — approving the server doesn't approve every tool on it. This
// flags servers with tools still awaiting classification (deny-by-default)
// or explicitly denied. Only evaluates servers this workflow can actually
// reach (i.e. present in mcpRefs) — a denied/pending tool on a server this
// workflow doesn't use isn't this workflow's problem.
function evalMcpToolAllowlist(_workflow, _nodes, _pii, config, mcpRefs = [], mcpTools = []) {
  const blockPending = config.block_pending_tools !== 'false';
  const msgs = [];

  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    const toolsForServer = mcpTools.filter(t => t.server_id === ref.mcp_server_id);
    const denied  = toolsForServer.filter(t => t.approval_status === 'denied');
    const pending = toolsForServer.filter(t => t.approval_status === 'pending');

    if (denied.length > 0) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has ${denied.length} denied tool(s) available: ${denied.map(t => t.name).join(', ')}`);
    }
    if (blockPending && pending.length > 0) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has ${pending.length} tool(s) awaiting classification: ${pending.map(t => t.name).join(', ')}`);
    }
  }
  return msgs;
}

// Token passthrough and missing audience restriction are the two conditions
// the MCP security guidance and OWASP both call out as core risks. A server
// with no authorization posture recorded at all is flagged too — silence
// here isn't evidence of safety, same "unassessed ≠ clean" principle as
// registration. This rule's severity should be set to 'critical' when bound
// (see rule_schemas.description) since token passthrough is a serious finding.
function evalMcpAuthorizationPosture(_workflow, _nodes, _pii, config, mcpRefs = [], _mcpTools = [], mcpAuthorizations = []) {
  const requireAudience = config.require_audience_restriction !== 'false';
  const msgs = [];

  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    const auths = mcpAuthorizations.filter(a => a.server_id === ref.mcp_server_id);

    if (auths.length === 0) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has no authorization posture recorded`);
      continue;
    }
    for (const auth of auths) {
      if (auth.token_passthrough_detected) {
        msgs.push(`MCP server "${label}" (node "${ref.node_name}") has token passthrough detected — treat as critical`);
      }
      if (requireAudience && !auth.oauth_audience) {
        msgs.push(`MCP server "${label}" (node "${ref.node_name}") authorization has no audience restriction configured`);
      }
    }
  }
  return msgs;
}

// trusted_publisher comes through on mcpRefs directly (the same cross-schema
// join evalMcpServerRegistration uses already selects it) — no extra query needed.
function evalMcpUntrustedPublisher(_workflow, _nodes, _pii, _config, mcpRefs = []) {
  const msgs = [];
  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    if (!ref.trusted_publisher) {
      const label = ref.mcp_server_name ?? ref.server_reference;
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") is from an unverified/untrusted publisher${ref.publisher ? ` (${ref.publisher})` : ''}`);
    }
  }
  return msgs;
}

// Epic 5, Feature 5.3 — confirmed credential exposure (token passthrough, or
// a hardcoded-secret pattern match in the server's own config/resource data)
// is always critical, never a policy-configured severity — the insert loop
// below forces 'critical' for this rule_type regardless of rule.severity.
function evalMcpCredentialExposure(_workflow, _nodes, _pii, _config, mcpRefs = [], _mcpTools = [], mcpAuthorizations = [], mcpCredentialExposure = []) {
  const msgs = [];
  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    const auths = mcpAuthorizations.filter(a => a.server_id === ref.mcp_server_id);
    if (auths.some(a => a.token_passthrough_detected)) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has token passthrough detected — rotate the exposed credential immediately and use the platform's authorization flow instead of forwarding a client token`);
    }

    const findings = mcpCredentialExposure.filter(f => f.server_id === ref.mcp_server_id);
    for (const f of findings) {
      const location = f.source_type === 'resource_uri' ? 'resource URI template' : `configuration field "${f.field_name}"`;
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has a confirmed ${f.secret_type} credential exposed in its ${location} (${f.redacted_preview}) — rotate the credential immediately and remove it from stored configuration`);
    }
  }
  return msgs;
}

// Epic 6, Features 6.3/6.4 — evidence that was once validated but has since
// expired (a credential-rotation or revocation test gone stale) needs a
// reviewer to revalidate or resubmit it. Unlike mcp_credential_exposure,
// this one's severity IS policy-configurable — how urgently to treat lapsed
// evidence is a judgment call, not a critical-by-definition finding.
function evalMcpStaleAssuranceEvidence(_workflow, _nodes, _pii, _config, mcpRefs = [], _mcpTools = [], _mcpAuthorizations = [], _mcpCredentialExposure = [], mcpAssuranceEvidence = []) {
  const msgs = [];
  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    const expired = mcpAssuranceEvidence.filter(e => e.server_id === ref.mcp_server_id && e.status === 'expired');
    for (const e of expired) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has expired assurance evidence (${e.evidence_type}) — revalidate or resubmit before continuing to rely on it`);
    }
  }
  return msgs;
}

// EP-105-S7 — starter policy pack gap: flags an MCP server whose
// expiration_date has passed. Requires expiration_date on mcpRefs/selfRef
// (added below in evaluateWorkflow's join and evaluateMcpServer's selfRef) —
// previously not selected at all, so this condition could never be evaluated.
function evalMcpApprovalExpiration(_workflow, _nodes, _pii, _config, mcpRefs = []) {
  const msgs = [];
  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    if (ref.expiration_date && new Date(ref.expiration_date) < new Date()) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") approval expired on ${new Date(ref.expiration_date).toISOString().slice(0, 10)} — reapprove before continuing to rely on it`);
    }
  }
  return msgs;
}

// EP-105-S9 — starter policy pack gap: "tool definition drift — already
// partially implemented, complete enforcement". tools.js already reverts a
// drifted tool's approval_status to 'pending' and records the change in
// mcp_tool_definition_history (Epic 3, Feature 3.3) — but nothing ever
// turned that into a governance violation. A drifted-and-still-pending tool
// is exactly the same "reachable but unreviewed" risk evalMcpToolAllowlist
// already flags for a never-classified tool.
function evalMcpToolDefinitionDrift(_workflow, _nodes, _pii, _config, mcpRefs = [], mcpTools = []) {
  const msgs = [];
  for (const ref of mcpRefs.filter(r => r.registered && r.mcp_server_id)) {
    const label = ref.mcp_server_name ?? ref.server_reference;
    const drifted = mcpTools.filter(t => t.server_id === ref.mcp_server_id && t.last_drift_detected_at && t.approval_status === 'pending');
    for (const t of drifted) {
      msgs.push(`MCP server "${label}" (node "${ref.node_name}") has tool "${t.name}" with an unreviewed definition change since ${new Date(t.last_drift_detected_at).toISOString().slice(0, 10)} — reapprove or deny before continuing to rely on it`);
    }
  }
  return msgs;
}

// execution_rate and prompt_inspection require runtime/content data — skipped in static eval
const SKIP = () => [];

const EVALUATORS = {
  pii_detection:               evalPiiDetection,
  ai_provider_detection:       evalAiProviderDetection,
  data_classification:         evalDataClassification,
  approval_requirement:        evalApprovalRequirement,
  encryption_enforcement:      evalEncryptionEnforcement,
  token_limit:                 evalTokenLimit,
  model_allowlist:              evalModelAllowlist,
  workflow_scope:              evalWorkflowScope,
  outbound_domain:             evalOutboundDomain,
  mcp_server_registration:     evalMcpServerRegistration,
  mcp_tool_allowlist:          evalMcpToolAllowlist,
  mcp_authorization_posture:   evalMcpAuthorizationPosture,
  mcp_untrusted_publisher:     evalMcpUntrustedPublisher,
  mcp_credential_exposure:     evalMcpCredentialExposure,
  mcp_stale_assurance_evidence: evalMcpStaleAssuranceEvidence,
  mcp_approval_expiration:     evalMcpApprovalExpiration,
  mcp_tool_definition_drift:   evalMcpToolDefinitionDrift,
  ...Object.fromEntries(UNEVALUATED_RULE_TYPES.map(type => [type, SKIP])),
};

// This rule's severity is never left to policy configuration — a confirmed
// credential exposure is critical by definition (WBS Feature 5.3).
const FORCED_SEVERITY = { mcp_credential_exposure: 'critical' };

// ── Main export ─────────────────────────────────────────────────────────────

/**
 * Evaluate a workflow against all policies bound to it.
 * Inserts new violations; skips duplicates (same workflow + rule already open).
 * Returns the array of violation rows inserted.
 */
// Epic 4, Feature 4.5 — a policy bound DIRECTLY to an MCP server (entity_type
// = 'mcp_server') was previously inert: evaluateWorkflow() only resolves
// bindings scoped to entity_type = 'workflow', so a server-bound policy never
// ran against anything. This evaluates a server against its own direct
// bindings, independent of whether any workflow references it — reusing the
// same MCP-aware evaluators via a synthetic single-element ref representing
// the server itself (no workflow node context to report).
export async function evaluateMcpServer(serverId) {
  const client = await pool.connect();
  try {
    const { rows: [server] } = await client.query(
      'SELECT * FROM mcp_governance.mcp_servers WHERE id = $1', [serverId]
    );
    if (!server) throw new Error(`MCP server ${serverId} not found`);

    const { rows: bindings } = await client.query(
      `SELECT pb.policy_id
         FROM policy_bindings pb
        WHERE pb.entity_type = 'mcp_server' AND pb.entity_id = $1
          AND (pb.effective_to IS NULL OR pb.effective_to > NOW())`,
      [serverId]
    );
    if (bindings.length === 0) return [];

    const policyIds = bindings.map(b => b.policy_id);
    // EP-103-S1 — policy_version snapshots policies.version at evaluation
    // time for violation_history, since the policy itself may be
    // edited/versioned later.
    const { rows: rules } = await client.query(
      `SELECT pr.*, p.version AS policy_version
         FROM policy_rules pr JOIN policies p ON p.id = pr.policy_id
        WHERE pr.policy_id = ANY($1::uuid[]) AND pr.rule_type IS NOT NULL AND pr.enabled = true`,
      [policyIds]
    );

    const [{ rows: mcpTools }, { rows: mcpAuthorizations }, { rows: mcpCredentialExposure }, { rows: mcpAssuranceEvidence }] = await Promise.all([
      client.query('SELECT * FROM mcp_governance.mcp_tools WHERE server_id = $1', [serverId]),
      client.query('SELECT * FROM mcp_governance.mcp_authorizations WHERE server_id = $1', [serverId]),
      client.query('SELECT * FROM mcp_governance.mcp_credential_exposure WHERE server_id = $1', [serverId]),
      client.query('SELECT * FROM mcp_governance.mcp_assurance_evidence WHERE server_id = $1', [serverId]),
    ]);

    const selfRef = [{
      node_name: null, server_reference: server.name, registered: true,
      mcp_server_id: server.id, mcp_server_name: server.name,
      server_status: server.status, trusted_publisher: server.trusted_publisher, publisher: server.publisher,
      expiration_date: server.expiration_date,
    }];

    const inserted = [];

    for (const rule of rules) {
      const evaluator = EVALUATORS[rule.rule_type];
      // mcp_server_registration asks "is the referenced server registered" —
      // meaningless for a policy bound directly to a server that, by
      // definition, already exists in the registry. Skip rather than
      // evaluate something that can never produce a real finding here.
      if (!evaluator || rule.rule_type === 'mcp_server_registration') continue;

      const messages = evaluator(null, [], [], rule.config_json ?? {}, selfRef, mcpTools, mcpAuthorizations, mcpCredentialExposure, mcpAssuranceEvidence);
      const severity = FORCED_SEVERITY[rule.rule_type] ?? rule.severity;

      // EP-311-P0 — coverage instrumentation: record that this rule ran
      // against this entity, regardless of outcome.
      await client.query(
        `INSERT INTO rule_evaluations (entity_type, entity_id, rule_id, policy_id, last_result)
         VALUES ('mcp_server', $1, $2, $3, $4)
         ON CONFLICT (entity_type, entity_id, rule_id)
         DO UPDATE SET last_result = EXCLUDED.last_result, evaluated_at = NOW()`,
        [serverId, rule.id, rule.policy_id, messages.length ? 'violation' : 'clean']
      );

      // EP-105-S3 — 'open'/'reopened' are both "currently active"; 'resolved'
      // is checked separately so a message that reappears reopens the same
      // violation (preserving its history/identity) instead of creating a
      // duplicate row for a condition that was already seen once before.
      const { rows: existing } = await client.query(
        `SELECT id, message, status FROM violations
          WHERE entity_type = 'mcp_server' AND entity_id = $1 AND rule_id = $2
            AND status IN ('open', 'reopened', 'resolved')`,
        [serverId, rule.id]
      );
      const currentMessages = new Set(messages);
      const active   = existing.filter(v => v.status === 'open' || v.status === 'reopened');
      const resolved = new Map(existing.filter(v => v.status === 'resolved').map(v => [v.message, v]));
      const activeMessages = new Set(active.map(v => v.message));

      for (const v of active) {
        if (currentMessages.has(v.message)) continue;
        await client.query(
          `UPDATE violations SET status = 'resolved', resolved_at = NOW(), resolution_reason = $1 WHERE id = $2`,
          ['Automatically resolved — condition no longer detected on re-evaluation', v.id]
        );
        // EP-103-S1/S3 — auto-resolution is a status transition too, not just
        // the manual PATCH /:id/status path.
        await client.query(
          `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
           VALUES ($1, $2, 'resolved', 'system', $3, $4)`,
          [v.id, v.status, 'Automatically resolved — condition no longer detected on re-evaluation', rule.policy_version]
        );
      }

      for (const message of messages) {
        if (activeMessages.has(message)) continue;

        const priorResolved = resolved.get(message);
        if (priorResolved) {
          const { rows: [violation] } = await client.query(
            `UPDATE violations SET status = 'reopened', resolved_at = NULL, resolution_reason = NULL WHERE id = $1 RETURNING *`,
            [priorResolved.id]
          );
          inserted.push(violation);
          await client.query(
            `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
             VALUES ($1, 'resolved', 'reopened', 'system', $2, $3)`,
            [priorResolved.id, 'Reopened — condition detected again on re-evaluation', rule.policy_version]
          );
          continue;
        }

        const { rows: [violation] } = await client.query(
          `INSERT INTO violations (workflow_id, entity_type, entity_id, rule_id, policy_id, severity, message)
           VALUES (NULL, 'mcp_server', $1, $2, $3, $4, $5)
           RETURNING *`,
          [serverId, rule.id, rule.policy_id, severity, message]
        );
        inserted.push(violation);
        await client.query(
          `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
           VALUES ($1, NULL, 'open', 'system', 'Created by policy re-evaluation', $2)`,
          [violation.id, rule.policy_version]
        );
      }
    }

    return inserted;
  } finally {
    client.release();
  }
}

export async function evaluateWorkflow(workflowId) {
  const client = await pool.connect();
  try {
    // Fetch workflow + its nodes + PII rows + MCP references (cross-schema,
    // fully qualified — mcp_references also joins into mcp_governance to
    // resolve the referenced server's current approval status).
    const [{ rows: [workflow] }, { rows: nodes }, { rows: piiRows }, { rows: mcpRefs }] = await Promise.all([
      client.query('SELECT * FROM workflow_governance.workflows WHERE id = $1', [workflowId]),
      client.query('SELECT * FROM workflow_governance.workflow_nodes WHERE workflow_id = $1', [workflowId]),
      client.query('SELECT * FROM workflow_governance.workflow_pii_exposure WHERE workflow_id = $1', [workflowId]),
      client.query(
        `SELECT wmr.*, s.status AS server_status, s.trusted_publisher, s.publisher, s.expiration_date
           FROM workflow_governance.workflow_mcp_references wmr
           LEFT JOIN mcp_governance.mcp_servers s ON s.id = wmr.mcp_server_id
          WHERE wmr.workflow_id = $1`,
        [workflowId]
      ),
    ]);

    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    // Find all policies bound directly to this workflow
    const { rows: bindings } = await client.query(
      `SELECT pb.policy_id
         FROM policy_bindings pb
        WHERE pb.entity_type = 'workflow' AND pb.entity_id = $1
          AND (pb.effective_to IS NULL OR pb.effective_to > NOW())`,
      [workflowId]
    );

    if (bindings.length === 0) return [];

    const policyIds = bindings.map(b => b.policy_id);
    // EP-103-S1 — policy_version snapshots policies.version at evaluation
    // time for violation_history, since the policy itself may be
    // edited/versioned later.
    const { rows: rules } = await client.query(
      `SELECT pr.*, p.version AS policy_version
         FROM policy_rules pr JOIN policies p ON p.id = pr.policy_id
        WHERE pr.policy_id = ANY($1::uuid[])
          AND pr.rule_type IS NOT NULL
          AND pr.enabled = true`,
      [policyIds]
    );

    // Tools/authorizations for any MCP server this workflow actually
    // references — fetched only once we know policies are bound, since most
    // workflows won't have MCP rules to evaluate against them.
    const referencedServerIds = [...new Set(mcpRefs.filter(r => r.mcp_server_id).map(r => r.mcp_server_id))];
    const [{ rows: mcpTools }, { rows: mcpAuthorizations }, { rows: mcpCredentialExposure }, { rows: mcpAssuranceEvidence }] = referencedServerIds.length > 0
      ? await Promise.all([
          client.query('SELECT * FROM mcp_governance.mcp_tools WHERE server_id = ANY($1::uuid[])', [referencedServerIds]),
          client.query('SELECT * FROM mcp_governance.mcp_authorizations WHERE server_id = ANY($1::uuid[])', [referencedServerIds]),
          client.query('SELECT * FROM mcp_governance.mcp_credential_exposure WHERE server_id = ANY($1::uuid[])', [referencedServerIds]),
          client.query('SELECT * FROM mcp_governance.mcp_assurance_evidence WHERE server_id = ANY($1::uuid[])', [referencedServerIds]),
        ])
      : [{ rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }];

    const inserted = [];

    for (const rule of rules) {
      const evaluator = EVALUATORS[rule.rule_type];
      if (!evaluator) continue;

      const messages = evaluator(workflow, nodes, piiRows, rule.config_json ?? {}, mcpRefs, mcpTools, mcpAuthorizations, mcpCredentialExposure, mcpAssuranceEvidence);
      const severity = FORCED_SEVERITY[rule.rule_type] ?? rule.severity;

      // EP-311-P0 — coverage instrumentation: record that this rule ran
      // against this entity, regardless of outcome.
      await client.query(
        `INSERT INTO rule_evaluations (entity_type, entity_id, rule_id, policy_id, last_result)
         VALUES ('workflow', $1, $2, $3, $4)
         ON CONFLICT (entity_type, entity_id, rule_id)
         DO UPDATE SET last_result = EXCLUDED.last_result, evaluated_at = NOW()`,
        [workflowId, rule.id, rule.policy_id, messages.length ? 'violation' : 'clean']
      );

      // Fetch all existing non-terminal-history violations for this rule
      // ONCE (not once per message — the old per-message dedup query would
      // see its own just-inserted sibling row within the same session and
      // silently drop every message after the first).
      // EP-105-S3 — 'open'/'reopened' are both "currently active"; 'resolved'
      // is checked separately so a message that reappears reopens the same
      // violation (preserving its history/identity) instead of creating a
      // duplicate row for a condition that was already seen once before.
      const { rows: existing } = await client.query(
        `SELECT id, message, status FROM violations
          WHERE workflow_id = $1 AND rule_id = $2 AND status IN ('open', 'reopened', 'resolved')`,
        [workflowId, rule.id]
      );
      const currentMessages = new Set(messages);
      const active   = existing.filter(v => v.status === 'open' || v.status === 'reopened');
      const resolved = new Map(existing.filter(v => v.status === 'resolved').map(v => [v.message, v]));
      const activeMessages = new Set(active.map(v => v.message));

      // Epic 4, Feature 4.2 — a violation whose condition no longer produces
      // a message on re-evaluation (e.g. the referenced MCP server got
      // registered) is automatically resolved, not left open forever.
      for (const v of active) {
        if (currentMessages.has(v.message)) continue;
        await client.query(
          `UPDATE violations SET status = 'resolved', resolved_at = NOW(), resolution_reason = $1 WHERE id = $2`,
          ['Automatically resolved — condition no longer detected on re-evaluation', v.id]
        );
        // EP-103-S1/S3 — auto-resolution is a status transition too, not just
        // the manual PATCH /:id/status path.
        await client.query(
          `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
           VALUES ($1, $2, 'resolved', 'system', $3, $4)`,
          [v.id, v.status, 'Automatically resolved — condition no longer detected on re-evaluation', rule.policy_version]
        );
      }

      for (const message of messages) {
        if (activeMessages.has(message)) continue; // already open/reopened — don't duplicate

        const priorResolved = resolved.get(message);
        if (priorResolved) {
          const { rows: [violation] } = await client.query(
            `UPDATE violations SET status = 'reopened', resolved_at = NULL, resolution_reason = NULL WHERE id = $1 RETURNING *`,
            [priorResolved.id]
          );
          inserted.push(violation);
          await client.query(
            `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
             VALUES ($1, 'resolved', 'reopened', 'system', $2, $3)`,
            [priorResolved.id, 'Reopened — condition detected again on re-evaluation', rule.policy_version]
          );
          continue;
        }

        const { rows: [violation] } = await client.query(
          `INSERT INTO violations (workflow_id, entity_type, entity_id, rule_id, policy_id, severity, message)
           VALUES ($1, 'workflow', $1, $2, $3, $4, $5)
           RETURNING *`,
          [workflowId, rule.id, rule.policy_id, severity, message]
        );
        inserted.push(violation);
        await client.query(
          `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
           VALUES ($1, NULL, 'open', 'system', 'Created by policy re-evaluation', $2)`,
          [violation.id, rule.policy_version]
        );
      }
    }

    return inserted;
  } finally {
    client.release();
  }
}

// EP-201-S12/S13 — direct-request AI model governance. Unlike
// evaluateMcpServer/evaluateWorkflow, there's exactly one seeded policy for
// this asset type (db/migrations/governance/032_ai_model_governance_policy.sql)
// meant to apply to every model without an admin manually binding it —
// so this auto-binds the policy to the model on first evaluation (idempotent
// via policy_bindings' own UNIQUE(policy_id, entity_type, entity_id)) rather
// than requiring that step up front. Once bound, POST /enforce's own
// bindings query (enforcement.js) picks it up exactly like any other bound
// policy — this function only needs to produce the violation, not duplicate
// the mode/outcome decision the route already makes generically.
//
// context.dataClassification is a property of the REQUEST, not the model's
// own stored state, so — unlike every other evaluator here — this one takes
// an extra parameter the generic dispatch passes through unused by the
// other asset types.
const CLASSIFICATION_RANK = { public: 0, internal: 1, confidential: 2, restricted: 3 };

export async function evaluateAiModel(modelId, context = {}) {
  const { rows: [model] } = await pool.query(
    'SELECT id, name, provider, is_sanctioned FROM ai_inference.models WHERE id = $1',
    [modelId]
  );
  if (!model) return [];

  const { rows: [policy] } = await pool.query(
    `SELECT id, enforcement_mode FROM policies WHERE name = 'AI Model Direct-Request Governance'`
  );
  if (!policy) return []; // migration 032 not applied — nothing to evaluate against

  await pool.query(
    `INSERT INTO policy_bindings (policy_id, entity_type, entity_id)
     VALUES ($1, 'ai_model', $2) ON CONFLICT (policy_id, entity_type, entity_id) DO NOTHING`,
    [policy.id, modelId]
  );

  const { rows: [rule] } = await pool.query(
    `SELECT id, config_json, severity FROM policy_rules WHERE policy_id = $1 AND rule_type = 'ai_model_governance' AND enabled = true`,
    [policy.id]
  );
  if (!rule) return [];

  const config = rule.config_json ?? {};
  const messages = [];

  if (config.require_sanctioned !== 'false' && !model.is_sanctioned) {
    messages.push(`Model "${model.name}" (provider: ${model.provider ?? 'unknown'}) is not sanctioned`);
  }

  const maxClass = config.max_data_classification;
  const requestClass = context.dataClassification;
  if (maxClass && requestClass && CLASSIFICATION_RANK[requestClass] > CLASSIFICATION_RANK[maxClass]) {
    messages.push(`Request carries data classified "${requestClass}", exceeding the maximum allowed "${maxClass}" for model "${model.name}"`);
  }

  // EP-311-P0 — coverage instrumentation: record that this rule ran against
  // this entity, regardless of outcome.
  await pool.query(
    `INSERT INTO rule_evaluations (entity_type, entity_id, rule_id, policy_id, last_result)
     VALUES ('ai_model', $1, $2, $3, $4)
     ON CONFLICT (entity_type, entity_id, rule_id)
     DO UPDATE SET last_result = EXCLUDED.last_result, evaluated_at = NOW()`,
    [modelId, rule.id, policy.id, messages.length ? 'violation' : 'clean']
  );

  const { rows: existing } = await pool.query(
    `SELECT id, message, status FROM violations
      WHERE entity_type = 'ai_model' AND entity_id = $1 AND rule_id = $2
        AND status IN ('open', 'reopened', 'resolved')`,
    [modelId, rule.id]
  );
  const currentMessages = new Set(messages);
  const active   = existing.filter(v => v.status === 'open' || v.status === 'reopened');
  const resolved = new Map(existing.filter(v => v.status === 'resolved').map(v => [v.message, v]));
  const activeMessages = new Set(active.map(v => v.message));

  for (const v of active) {
    if (currentMessages.has(v.message)) continue;
    await pool.query(
      `UPDATE violations SET status = 'resolved', resolved_at = NOW(), resolution_reason = $1 WHERE id = $2`,
      ['Automatically resolved — condition no longer detected on re-evaluation', v.id]
    );
    await pool.query(
      `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
       VALUES ($1, $2, 'resolved', 'system', $3, 1)`,
      [v.id, v.status, 'Automatically resolved — condition no longer detected on re-evaluation']
    );
  }

  const inserted = [];
  for (const message of messages) {
    if (activeMessages.has(message)) continue;

    const priorResolved = resolved.get(message);
    if (priorResolved) {
      const { rows: [violation] } = await pool.query(
        `UPDATE violations SET status = 'reopened', resolved_at = NULL, resolution_reason = NULL WHERE id = $1 RETURNING *`,
        [priorResolved.id]
      );
      inserted.push(violation);
      await pool.query(
        `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
         VALUES ($1, 'resolved', 'reopened', 'system', $2, 1)`,
        [priorResolved.id, 'Reopened — condition detected again on re-evaluation']
      );
      continue;
    }

    const { rows: [violation] } = await pool.query(
      `INSERT INTO violations (workflow_id, entity_type, entity_id, rule_id, policy_id, severity, message)
       VALUES (NULL, 'ai_model', $1, $2, $3, $4, $5)
       RETURNING *`,
      [modelId, rule.id, policy.id, rule.severity, message]
    );
    inserted.push(violation);
    await pool.query(
      `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
       VALUES ($1, NULL, 'open', 'system', 'Created by policy re-evaluation', 1)`,
      [violation.id]
    );
  }

  return inserted;
}

// Zapier -> IOA enforcement (proof-of-concept direction) — Zapier has no
// registry of "zaps" in IOA the way mcp_servers or ai_inference.models do,
// so zapId is whatever the caller's Zap reports as its own name/id, not a
// row to look up. Same auto-bind-on-first-evaluation shape as
// evaluateAiModel: one seeded policy, no per-Zap registration step needed
// before the first call gets a real decision. context carries whatever the
// Zap's "Webhooks by Zapier" step sends beyond the bare asset_id — trigger
// and action app slugs are the two this checks today.
export async function evaluateZap(zapId, context = {}) {
  const { rows: [policy] } = await pool.query(
    `SELECT id, enforcement_mode FROM policies WHERE name = 'Zapier Zap Execution Governance'`
  );
  if (!policy) return []; // migration 033 not applied — nothing to evaluate against

  await pool.query(
    `INSERT INTO policy_bindings (policy_id, entity_type, entity_id)
     VALUES ($1, 'zap', $2) ON CONFLICT (policy_id, entity_type, entity_id) DO NOTHING`,
    [policy.id, zapId]
  );

  const { rows: [rule] } = await pool.query(
    `SELECT id, config_json, severity FROM policy_rules WHERE policy_id = $1 AND rule_type = 'zap_execution_governance' AND enabled = true`,
    [policy.id]
  );
  if (!rule) return [];

  const config = rule.config_json ?? {};
  const messages = [];

  const blockedIds = (config.blocked_zap_ids ?? []).map(String);
  if (blockedIds.includes(String(zapId))) {
    messages.push(`Zap "${zapId}" is on the blocked list`);
  }

  const blockedApps = (config.blocked_apps ?? []).map(a => String(a).toLowerCase());
  const triggerApp = context.triggerApp ? String(context.triggerApp).toLowerCase() : null;
  const actionApp  = context.actionApp  ? String(context.actionApp).toLowerCase()  : null;
  for (const app of [triggerApp, actionApp]) {
    if (app && blockedApps.includes(app)) {
      messages.push(`Zap "${zapId}" uses blocked app "${app}"`);
    }
  }

  // EP-311-P0 — coverage instrumentation: record that this rule ran against
  // this entity, regardless of outcome.
  await pool.query(
    `INSERT INTO rule_evaluations (entity_type, entity_id, rule_id, policy_id, last_result)
     VALUES ('zap', $1, $2, $3, $4)
     ON CONFLICT (entity_type, entity_id, rule_id)
     DO UPDATE SET last_result = EXCLUDED.last_result, evaluated_at = NOW()`,
    [zapId, rule.id, policy.id, messages.length ? 'violation' : 'clean']
  );

  const { rows: existing } = await pool.query(
    `SELECT id, message, status FROM violations
      WHERE entity_type = 'zap' AND entity_id = $1 AND rule_id = $2
        AND status IN ('open', 'reopened', 'resolved')`,
    [zapId, rule.id]
  );
  const currentMessages = new Set(messages);
  const active   = existing.filter(v => v.status === 'open' || v.status === 'reopened');
  const resolved = new Map(existing.filter(v => v.status === 'resolved').map(v => [v.message, v]));
  const activeMessages = new Set(active.map(v => v.message));

  for (const v of active) {
    if (currentMessages.has(v.message)) continue;
    await pool.query(
      `UPDATE violations SET status = 'resolved', resolved_at = NOW(), resolution_reason = $1 WHERE id = $2`,
      ['Automatically resolved — condition no longer detected on re-evaluation', v.id]
    );
    await pool.query(
      `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
       VALUES ($1, $2, 'resolved', 'system', $3, 1)`,
      [v.id, v.status, 'Automatically resolved — condition no longer detected on re-evaluation']
    );
  }

  const inserted = [];
  for (const message of messages) {
    if (activeMessages.has(message)) continue;

    const priorResolved = resolved.get(message);
    if (priorResolved) {
      const { rows: [violation] } = await pool.query(
        `UPDATE violations SET status = 'reopened', resolved_at = NULL, resolution_reason = NULL WHERE id = $1 RETURNING *`,
        [priorResolved.id]
      );
      inserted.push(violation);
      await pool.query(
        `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
         VALUES ($1, 'resolved', 'reopened', 'system', $2, 1)`,
        [priorResolved.id, 'Reopened — condition detected again on re-evaluation']
      );
      continue;
    }

    const { rows: [violation] } = await pool.query(
      `INSERT INTO violations (workflow_id, entity_type, entity_id, rule_id, policy_id, severity, message)
       VALUES (NULL, 'zap', $1, $2, $3, $4, $5)
       RETURNING *`,
      [zapId, rule.id, policy.id, rule.severity, message]
    );
    inserted.push(violation);
    await pool.query(
      `INSERT INTO violation_history (violation_id, prev_status, new_status, actor, reason, policy_version)
       VALUES ($1, NULL, 'open', 'system', 'Created by policy re-evaluation', 1)`,
      [violation.id]
    );
  }

  return inserted;
}
