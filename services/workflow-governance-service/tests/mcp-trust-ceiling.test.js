import { describe, it, expect } from 'vitest';
import mcpTrustCeiling from '../src/lib/mcp-trust-ceiling.js';

function makeServer(overrides = {}) {
  return {
    name: 'filesystem-mcp',
    hosting_environment: 'production',
    technical_owner: 'jane@company.com',
    business_owner: 'finance-lead',
    tools: [],
    authorizations: [],
    ...overrides,
  };
}

describe('deriveMcpCeilings', () => {
  it('caps at 40 for an unregistered server reference', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'unknown-host', registered: false, mcp_server_id: null }];
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, new Map());
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 40 }));
  });

  it('produces no ceilings for a registered, owned, fully-approved server', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer()]]);
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, details)).toEqual([]);
  });

  it('caps at 50 when a tool has unreviewed drift (pending after a previously-approved change)', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      tools: [{ approval_status: 'pending', last_drift_detected_at: '2026-07-01T00:00:00Z' }],
    })]]);
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, details);
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 50 }));
  });

  it('does not flag drift for a tool that is merely pending and never drifted', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      tools: [{ approval_status: 'pending', last_drift_detected_at: null }],
    })]]);
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, details)).toEqual([]);
  });

  it('caps at 35 for unapproved write-capable tools in production', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      tools: [{ behavior: 'write', approval_status: 'pending' }],
    })]]);
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, details);
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 35 }));
  });

  it('does not cap for write-capable tools in non-production environments', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      hosting_environment: 'development',
      tools: [{ behavior: 'write', approval_status: 'pending' }],
    })]]);
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, details).some(c => c.cap === 35)).toBe(false);
  });

  it('caps at 84 (blocks VERIFIED) when a server has no assigned owner', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({ technical_owner: null, business_owner: null })]]);
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, details);
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 84 }));
  });

  it('caps at 15 (critical) when token passthrough is detected', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      authorizations: [{ token_passthrough_detected: true }],
    })]]);
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, details);
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 15 }));
  });

  // Epic 5, Feature 5.3 — Credential Exposure Detection
  it('caps at 15 (critical) when a confirmed credential exposure finding exists', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      credential_exposure: [{ secret_type: 'aws_access_key', redacted_preview: 'AKIA****CDEF' }],
    })]]);
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, details);
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 15 }));
  });

  it('does not cap for credential exposure when the list is empty', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({ credential_exposure: [] })]]);
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, details)).toEqual([]);
  });

  // Epic 6, Features 6.3/6.4 — expired assurance evidence
  it('caps at 60 when a server has expired assurance evidence', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      assurance_evidence: [{ evidence_type: 'authorization_revocation_tested', status: 'expired' }],
    })]]);
    const ceilings = mcpTrustCeiling.deriveMcpCeilings(refs, details);
    expect(ceilings).toContainEqual(expect.objectContaining({ cap: 60 }));
  });

  it('does not cap when assurance evidence is validated (not expired)', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({
      assurance_evidence: [{ evidence_type: 'config_export', status: 'validated' }],
    })]]);
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, details)).toEqual([]);
  });

  it('does not cap a server with zero assurance evidence at all — "never assessed" is not penalized', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    const details = new Map([['srv-1', makeServer({ assurance_evidence: [] })]]);
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, details)).toEqual([]);
  });

  it('skips a registered reference whose server detail could not be fetched', () => {
    const refs = [{ node_name: 'MCP Client', server_reference: 'srv', registered: true, mcp_server_id: 'srv-1' }];
    expect(mcpTrustCeiling.deriveMcpCeilings(refs, new Map())).toEqual([]);
  });

  it('returns no ceilings for a workflow with no MCP references at all', () => {
    expect(mcpTrustCeiling.deriveMcpCeilings([], new Map())).toEqual([]);
  });
});
