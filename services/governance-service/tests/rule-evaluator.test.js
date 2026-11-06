import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { connect: vi.fn() },
}));
import pool from '../db.js';
import { evaluateWorkflow, evaluateMcpServer } from '../src/lib/rule-evaluator.js';

const WORKFLOW = { id: 'wf-1', name: 'Test Workflow', tags: [] };

// Builds a query-router mock covering every query evaluateWorkflow can issue,
// with sensible empty defaults — each test overrides only what it cares about.
function buildMockClient({
  workflow = WORKFLOW, nodes = [], pii = [], mcpRefs = [], bindings = [],
  rules = [], existingOpenViolations = [], insertedViolation = null,
  mcpTools = [], mcpAuthorizations = [], mcpCredentialExposure = [], mcpAssuranceEvidence = [],
} = {}) {
  const client = {
    query: vi.fn(async (sql) => {
      if (sql.includes('FROM workflow_governance.workflows'))              return { rows: workflow ? [workflow] : [] };
      if (sql.includes('FROM workflow_governance.workflow_nodes'))         return { rows: nodes };
      if (sql.includes('FROM workflow_governance.workflow_pii_exposure'))  return { rows: pii };
      if (sql.includes('FROM workflow_governance.workflow_mcp_references')) return { rows: mcpRefs };
      if (sql.includes('FROM policy_bindings'))                            return { rows: bindings };
      if (sql.includes('FROM policy_rules'))                               return { rows: rules };
      if (sql.includes('FROM mcp_governance.mcp_tools'))                   return { rows: mcpTools };
      if (sql.includes('FROM mcp_governance.mcp_authorizations'))          return { rows: mcpAuthorizations };
      if (sql.includes('FROM mcp_governance.mcp_credential_exposure'))     return { rows: mcpCredentialExposure };
      if (sql.includes('FROM mcp_governance.mcp_assurance_evidence'))      return { rows: mcpAssuranceEvidence };
      if (sql.startsWith('SELECT id, message, status FROM violations')) return { rows: existingOpenViolations };
      // EP-105-S3 — the reopen UPDATE has a RETURNING clause (the resolve
      // UPDATE doesn't), so it needs an actual row back — the id of
      // whichever existing violation this test marked 'resolved'.
      if (sql.startsWith('UPDATE violations') && sql.includes('RETURNING')) {
        const reopened = existingOpenViolations.find(v => v.status === 'resolved');
        return { rows: [{ id: reopened?.id ?? 'v-new', entity_type: 'workflow', entity_id: 'wf-1', status: 'reopened' }] };
      }
      if (sql.startsWith('UPDATE violations'))                            return { rows: [] };
      if (sql.startsWith('INSERT INTO violations'))                       return { rows: [insertedViolation ?? { id: 'v-new', entity_type: 'workflow', entity_id: 'wf-1' }] };
      // EP-103-S1/S3 — every created/auto-resolved violation gets a history row
      if (sql.startsWith('INSERT INTO violation_history'))                return { rows: [] };
      // EP-311-P0 — coverage instrumentation upsert, fired for every rule
      // regardless of outcome.
      if (sql.startsWith('INSERT INTO rule_evaluations'))                 return { rows: [] };
      throw new Error(`Unexpected query in test: ${sql}`);
    }),
    release: vi.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => vi.clearAllMocks());

describe('evaluateWorkflow', () => {
  const RULE = {
    id: 'rule-1', policy_id: 'policy-1', rule_type: 'approval_requirement',
    severity: 'high', config_json: {}, enabled: true,
  };

  it('inserts a violation with entity_type/entity_id mirroring workflow_id', async () => {
    const client = buildMockClient({ bindings: [{ policy_id: 'policy-1' }], rules: [RULE] });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ entity_type: 'workflow', entity_id: 'wf-1' });

    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[0]).toContain('entity_type');
    expect(insertCall[0]).toContain('entity_id');
    // workflow_id ($1) is reused for entity_id — no separate entity_id param needed
    expect(insertCall[1][0]).toBe('wf-1');
  });

  it('skips workflows with no policy bindings', async () => {
    buildMockClient({ bindings: [] });
    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

describe('evaluateWorkflow — mcp_server_registration', () => {
  const MCP_RULE = {
    id: 'rule-mcp', policy_id: 'policy-1', rule_type: 'mcp_server_registration',
    severity: 'critical', config_json: {}, enabled: true,
  };

  it('flags a workflow referencing an unregistered MCP server', async () => {
    const client = buildMockClient({
      mcpRefs: [{ node_name: 'Filesystem MCP', server_reference: 'https://mcp.example.com', registered: false, mcp_server_id: null }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [MCP_RULE],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('unregistered MCP server');
  });

  it('does not flag a registered, approved MCP server reference', async () => {
    buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', server_status: 'approved', trusted_publisher: true }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [MCP_RULE],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });

  it('flags a registered-but-not-approved server when require_approved_status is set', async () => {
    const strictRule = { ...MCP_RULE, config_json: { require_approved_status: 'true' } };
    const client = buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', server_status: 'pending_review' }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [strictRule],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('registered but not yet approved');
  });
});

describe('evaluateWorkflow — mcp_tool_allowlist', () => {
  const RULE = {
    id: 'rule-tools', policy_id: 'policy-1', rule_type: 'mcp_tool_allowlist',
    severity: 'high', config_json: {}, enabled: true,
  };
  const REF = { node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp' };

  it('flags denied and pending tools on a referenced server as separate messages', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpTools: [
        { server_id: 'srv-1', name: 'delete_records', approval_status: 'denied' },
        { server_id: 'srv-1', name: 'search_contacts', approval_status: 'pending' },
        { server_id: 'srv-1', name: 'read_only_lookup', approval_status: 'allowed' },
        { server_id: 'srv-other', name: 'irrelevant', approval_status: 'denied' }, // different server — not this workflow's problem
      ],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(2); // one message for denied, one for pending
    const insertMessages = client.query.mock.calls
      .filter(c => c[0].startsWith('INSERT INTO violations'))
      .map(c => c[1][4]);
    expect(insertMessages.some(m => m.includes('denied tool'))).toBe(true);
    expect(insertMessages.some(m => m.includes('awaiting classification'))).toBe(true);
    expect(insertMessages.every(m => !m.includes('irrelevant'))).toBe(true);
  });

  it('does not flag when all tools on the referenced server are allowed', async () => {
    buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpTools: [{ server_id: 'srv-1', name: 'read_only_lookup', approval_status: 'allowed' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });

  it('does not block pending tools when block_pending_tools is false', async () => {
    const lenientRule = { ...RULE, config_json: { block_pending_tools: 'false' } };
    buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [lenientRule],
      mcpTools: [{ server_id: 'srv-1', name: 'search_contacts', approval_status: 'pending' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

describe('evaluateWorkflow — mcp_authorization_posture', () => {
  const RULE = {
    id: 'rule-auth', policy_id: 'policy-1', rule_type: 'mcp_authorization_posture',
    severity: 'critical', config_json: {}, enabled: true,
  };
  const REF = { node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp' };

  it('flags token passthrough', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAuthorizations: [{ server_id: 'srv-1', token_passthrough_detected: true, oauth_audience: 'my-audience' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('token passthrough');
  });

  it('flags missing authorization posture entirely', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAuthorizations: [],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('no authorization posture recorded');
  });

  it('does not flag a properly scoped, audience-restricted authorization', async () => {
    buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAuthorizations: [{ server_id: 'srv-1', token_passthrough_detected: false, oauth_audience: 'my-audience' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

describe('evaluateWorkflow — mcp_untrusted_publisher', () => {
  const RULE = {
    id: 'rule-pub', policy_id: 'policy-1', rule_type: 'mcp_untrusted_publisher',
    severity: 'high', config_json: {}, enabled: true,
  };

  it('flags a server not marked as a trusted publisher', async () => {
    const client = buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', trusted_publisher: false, publisher: 'some-random-repo' }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('untrusted publisher');
  });

  it('does not flag a trusted publisher', async () => {
    buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', trusted_publisher: true }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

// Epic 5, Feature 5.3 — Credential Exposure Detection
describe('evaluateWorkflow — mcp_credential_exposure', () => {
  const REF = { node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp' };
  // Deliberately configured with a non-critical severity — the point of this
  // rule type is that the configured severity is ignored and always forced
  // to 'critical' at insert time.
  const RULE = {
    id: 'rule-cred', policy_id: 'policy-1', rule_type: 'mcp_credential_exposure',
    severity: 'low', config_json: {}, enabled: true,
  };

  it('flags token passthrough and forces severity to critical regardless of the rule’s configured severity', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAuthorizations: [{ server_id: 'srv-1', token_passthrough_detected: true }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][3]).toBe('critical'); // severity param, not rule.severity ('low')
    expect(insertCall[1][4]).toContain('token passthrough');
  });

  it('flags a confirmed credential-exposure finding on a referenced server', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpCredentialExposure: [{
        server_id: 'srv-1', source_type: 'server_config', field_name: 'endpoint',
        secret_type: 'openai_key', redacted_preview: 'sk-a****xyz9',
      }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][3]).toBe('critical');
    expect(insertCall[1][4]).toContain('openai_key');
    expect(insertCall[1][4]).toContain('configuration field "endpoint"');
  });

  it('flags a resource_uri finding with different message wording than server_config', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpCredentialExposure: [{
        server_id: 'srv-1', source_type: 'resource_uri', field_name: 'uri_template',
        secret_type: 'basic_auth_url', redacted_preview: 'post****ret@',
      }],
    });

    const result = await evaluateWorkflow('wf-1');
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('resource URI template');
  });

  it('does not flag a server with no token passthrough and no credential exposure findings', async () => {
    buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAuthorizations: [{ server_id: 'srv-1', token_passthrough_detected: false }],
      mcpCredentialExposure: [],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });

  it('other MCP rule types are unaffected — their severity still comes from the rule, not forced', async () => {
    const untrustedPublisherRule = {
      id: 'rule-pub', policy_id: 'policy-1', rule_type: 'mcp_untrusted_publisher',
      severity: 'high', config_json: {}, enabled: true,
    };
    const client = buildMockClient({
      mcpRefs: [{ ...REF, trusted_publisher: false, publisher: 'unknown' }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [untrustedPublisherRule],
    });

    await evaluateWorkflow('wf-1');
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][3]).toBe('high'); // rule.severity, unforced
  });
});

// Epic 6, Features 6.3/6.4 — MCP Stale Assurance Evidence
describe('evaluateWorkflow — mcp_stale_assurance_evidence', () => {
  const REF = { node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp' };
  const RULE = {
    id: 'rule-stale', policy_id: 'policy-1', rule_type: 'mcp_stale_assurance_evidence',
    severity: 'medium', config_json: {}, enabled: true,
  };

  it('flags expired assurance evidence on a referenced server', async () => {
    const client = buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAssuranceEvidence: [{ server_id: 'srv-1', evidence_type: 'authorization_revocation_tested', status: 'expired' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][3]).toBe('medium'); // policy-configured severity, not forced
    expect(insertCall[1][4]).toContain('expired assurance evidence');
    expect(insertCall[1][4]).toContain('authorization_revocation_tested');
  });

  it('does not flag validated (non-expired) evidence', async () => {
    buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAssuranceEvidence: [{ server_id: 'srv-1', evidence_type: 'config_export', status: 'validated' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });

  it('does not flag a server with no assurance evidence at all', async () => {
    buildMockClient({
      mcpRefs: [REF],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      mcpAssuranceEvidence: [],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

// EP-105-S7
describe('evaluateWorkflow — mcp_approval_expiration', () => {
  const RULE = {
    id: 'rule-expiry', policy_id: 'policy-1', rule_type: 'mcp_approval_expiration',
    severity: 'high', config_json: {}, enabled: true,
  };

  it('flags a referenced server whose expiration_date has passed', async () => {
    const REF = {
      node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true,
      mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', expiration_date: '2020-01-01T00:00:00Z',
    };
    const client = buildMockClient({ mcpRefs: [REF], bindings: [{ policy_id: 'policy-1' }], rules: [RULE] });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('approval expired');
  });

  it('does not flag a server with no expiration_date set', async () => {
    const REF = {
      node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true,
      mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', expiration_date: null,
    };
    buildMockClient({ mcpRefs: [REF], bindings: [{ policy_id: 'policy-1' }], rules: [RULE] });
    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });

  it('does not flag a server whose expiration_date is in the future', async () => {
    const REF = {
      node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true,
      mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', expiration_date: '2099-01-01T00:00:00Z',
    };
    buildMockClient({ mcpRefs: [REF], bindings: [{ policy_id: 'policy-1' }], rules: [RULE] });
    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

// EP-105-S9
describe('evaluateWorkflow — mcp_tool_definition_drift', () => {
  const REF = { node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp' };
  const RULE = {
    id: 'rule-drift', policy_id: 'policy-1', rule_type: 'mcp_tool_definition_drift',
    severity: 'high', config_json: {}, enabled: true,
  };

  it('flags a drifted tool still awaiting reapproval', async () => {
    const client = buildMockClient({
      mcpRefs: [REF], bindings: [{ policy_id: 'policy-1' }], rules: [RULE],
      mcpTools: [{ server_id: 'srv-1', name: 'delete_records', approval_status: 'pending', last_drift_detected_at: '2026-01-01T00:00:00Z' }],
    });
    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][4]).toContain('unreviewed definition change');
  });

  it('does not flag a drifted tool that has already been reapproved', async () => {
    buildMockClient({
      mcpRefs: [REF], bindings: [{ policy_id: 'policy-1' }], rules: [RULE],
      mcpTools: [{ server_id: 'srv-1', name: 'delete_records', approval_status: 'allowed', last_drift_detected_at: '2026-01-01T00:00:00Z' }],
    });
    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });

  it('does not flag a tool with no drift on record', async () => {
    buildMockClient({
      mcpRefs: [REF], bindings: [{ policy_id: 'policy-1' }], rules: [RULE],
      mcpTools: [{ server_id: 'srv-1', name: 'delete_records', approval_status: 'pending', last_drift_detected_at: null }],
    });
    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]);
  });
});

// Epic 4, Feature 4.2 — violations auto-clear when the condition resolves
describe('evaluateWorkflow — auto-clearing stale violations', () => {
  const RULE = {
    id: 'rule-mcp', policy_id: 'policy-1', rule_type: 'mcp_server_registration',
    severity: 'critical', config_json: {}, enabled: true,
  };

  it('resolves an open violation when the referenced server becomes registered', async () => {
    // Previously flagged as unregistered; this run it's registered — the
    // rule now produces no message for it, so the stale violation should
    // be auto-resolved rather than left open forever.
    const client = buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp', server_status: 'approved' }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      existingOpenViolations: [{ id: 'v-stale', status: 'open', message: 'Workflow references unregistered MCP server "crm-mcp" (node "CRM MCP") — unassessed, not low-risk' }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]); // nothing new inserted

    const updateCall = client.query.mock.calls.find(c => c[0].startsWith('UPDATE violations'));
    expect(updateCall).toBeTruthy();
    expect(updateCall[1]).toEqual(['Automatically resolved — condition no longer detected on re-evaluation', 'v-stale']);
  });

  it('leaves an open violation alone when its condition is still detected', async () => {
    const message = 'Workflow references unregistered MCP server "https://crm.example.com" (node "CRM MCP") — unassessed, not low-risk';
    const client = buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: false, mcp_server_id: null }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      existingOpenViolations: [{ id: 'v-still-open', status: 'open', message }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toEqual([]); // no duplicate insert
    const updateCall = client.query.mock.calls.find(c => c[0].startsWith('UPDATE violations'));
    expect(updateCall).toBeUndefined(); // not resolved — still applies
  });

  // EP-105-S3 — a resolved violation whose condition reappears reopens the
  // same row (preserving its identity/history) instead of creating a
  // duplicate for a condition that was already seen and closed once before.
  it('reopens a resolved violation when its condition is detected again, instead of duplicating it', async () => {
    const message = 'Workflow references unregistered MCP server "https://crm.example.com" (node "CRM MCP") — unassessed, not low-risk';
    const client = buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: false, mcp_server_id: null }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [RULE],
      existingOpenViolations: [{ id: 'v-was-resolved', status: 'resolved', message }],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: 'v-was-resolved' });

    // reopens the existing row via UPDATE, not a fresh INSERT
    expect(client.query.mock.calls.some(c => c[0].startsWith('INSERT INTO violations'))).toBe(false);
    const updateCall = client.query.mock.calls.find(c => c[0].startsWith('UPDATE violations'));
    expect(updateCall[0]).toContain("status = 'reopened'");
    expect(updateCall[1]).toEqual(['v-was-resolved']);

    const historyInsert = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violation_history'));
    expect(historyInsert[0]).toContain("'resolved', 'reopened'");
    expect(historyInsert[1]).toEqual(['v-was-resolved', 'Reopened — condition detected again on re-evaluation', undefined]);
  });

  // Regression for the real bug this refactor fixes: the old per-message
  // dedup query would see its own just-inserted sibling row within the same
  // session and silently drop every message after the first for a rule that
  // produces multiple messages in one run.
  it('inserts every distinct message from a single rule in one evaluation, not just the first', async () => {
    const toolRule = { id: 'rule-tools', policy_id: 'policy-1', rule_type: 'mcp_tool_allowlist', severity: 'high', config_json: {}, enabled: true };
    buildMockClient({
      mcpRefs: [{ node_name: 'CRM MCP', server_reference: 'https://crm.example.com', registered: true, mcp_server_id: 'srv-1', mcp_server_name: 'crm-mcp' }],
      bindings: [{ policy_id: 'policy-1' }],
      rules: [toolRule],
      mcpTools: [
        { server_id: 'srv-1', name: 'delete_records', approval_status: 'denied' },
        { server_id: 'srv-1', name: 'search_contacts', approval_status: 'pending' },
      ],
    });

    const result = await evaluateWorkflow('wf-1');
    expect(result).toHaveLength(2);
  });
});

// Epic 4, Feature 4.5 — evaluate an MCP server directly against policies
// bound to it (entity_type = 'mcp_server'), independent of any workflow
function buildMcpServerMockClient({
  server = { id: 'srv-1', name: 'crm-mcp', status: 'approved', trusted_publisher: true, publisher: 'acme' },
  bindings = [], rules = [], mcpTools = [], mcpAuthorizations = [], mcpCredentialExposure = [], mcpAssuranceEvidence = [],
  existingOpenViolations = [], insertedViolation = null,
} = {}) {
  const client = {
    query: vi.fn(async (sql) => {
      if (sql.includes('FROM mcp_governance.mcp_servers WHERE id'))    return { rows: server ? [server] : [] };
      if (sql.includes('FROM policy_bindings'))                        return { rows: bindings };
      if (sql.includes('FROM policy_rules'))                           return { rows: rules };
      if (sql.includes('FROM mcp_governance.mcp_tools'))               return { rows: mcpTools };
      if (sql.includes('FROM mcp_governance.mcp_authorizations'))      return { rows: mcpAuthorizations };
      if (sql.includes('FROM mcp_governance.mcp_credential_exposure')) return { rows: mcpCredentialExposure };
      if (sql.includes('FROM mcp_governance.mcp_assurance_evidence'))  return { rows: mcpAssuranceEvidence };
      if (sql.startsWith('SELECT id, message, status FROM violations')) return { rows: existingOpenViolations };
      if (sql.startsWith('UPDATE violations'))                        return { rows: [] };
      if (sql.startsWith('INSERT INTO violations'))                   return { rows: [insertedViolation ?? { id: 'v-new', entity_type: 'mcp_server', entity_id: 'srv-1' }] };
      if (sql.startsWith('INSERT INTO violation_history'))            return { rows: [] };
      // EP-311-P0 — coverage instrumentation upsert, fired for every rule
      // regardless of outcome.
      if (sql.startsWith('INSERT INTO rule_evaluations'))             return { rows: [] };
      throw new Error(`Unexpected query in test: ${sql}`);
    }),
    release: vi.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

describe('evaluateMcpServer', () => {
  it('throws when the server does not exist', async () => {
    buildMcpServerMockClient({ server: null });
    await expect(evaluateMcpServer('unknown')).rejects.toThrow('MCP server unknown not found');
  });

  it('returns no violations when nothing is bound directly to the server', async () => {
    buildMcpServerMockClient({ bindings: [] });
    const result = await evaluateMcpServer('srv-1');
    expect(result).toEqual([]);
  });

  it('flags token passthrough via a policy bound directly to the server', async () => {
    const rule = { id: 'rule-auth', policy_id: 'policy-1', rule_type: 'mcp_authorization_posture', severity: 'critical', config_json: {}, enabled: true };
    const client = buildMcpServerMockClient({
      bindings: [{ policy_id: 'policy-1' }],
      rules: [rule],
      mcpAuthorizations: [{ server_id: 'srv-1', token_passthrough_detected: true, oauth_audience: 'some-audience' }],
    });

    const result = await evaluateMcpServer('srv-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[0]).toContain("'mcp_server'");
    expect(insertCall[1]).toEqual(['srv-1', 'rule-auth', 'policy-1', 'critical', expect.stringContaining('token passthrough')]);
  });

  it('skips mcp_server_registration — meaningless for a server bound directly to its own policy', async () => {
    const rule = { id: 'rule-reg', policy_id: 'policy-1', rule_type: 'mcp_server_registration', severity: 'high', config_json: {}, enabled: true };
    buildMcpServerMockClient({ bindings: [{ policy_id: 'policy-1' }], rules: [rule] });

    const result = await evaluateMcpServer('srv-1');
    expect(result).toEqual([]);
  });

  it('resolves a stale violation once the underlying condition clears', async () => {
    const rule = { id: 'rule-pub', policy_id: 'policy-1', rule_type: 'mcp_untrusted_publisher', severity: 'high', config_json: {}, enabled: true };
    const client = buildMcpServerMockClient({
      server: { id: 'srv-1', name: 'crm-mcp', status: 'approved', trusted_publisher: true, publisher: 'acme' }, // now trusted
      bindings: [{ policy_id: 'policy-1' }],
      rules: [rule],
      existingOpenViolations: [{ id: 'v-stale', status: 'open', message: 'MCP server "crm-mcp" (node "null") is from an unverified/untrusted publisher (acme)' }],
    });

    const result = await evaluateMcpServer('srv-1');
    expect(result).toEqual([]);
    const updateCall = client.query.mock.calls.find(c => c[0].startsWith('UPDATE violations'));
    expect(updateCall).toBeTruthy();
  });

  // Epic 6, Features 6.3/6.4
  it('flags expired assurance evidence via a policy bound directly to the server', async () => {
    const rule = { id: 'rule-stale', policy_id: 'policy-1', rule_type: 'mcp_stale_assurance_evidence', severity: 'medium', config_json: {}, enabled: true };
    const client = buildMcpServerMockClient({
      bindings: [{ policy_id: 'policy-1' }],
      rules: [rule],
      mcpAssuranceEvidence: [{ server_id: 'srv-1', evidence_type: 'redeployment_recovery_tested', status: 'expired' }],
    });

    const result = await evaluateMcpServer('srv-1');
    expect(result).toHaveLength(1);
    const insertCall = client.query.mock.calls.find(c => c[0].startsWith('INSERT INTO violations'));
    expect(insertCall[1][3]).toBe('medium');
  });
});
