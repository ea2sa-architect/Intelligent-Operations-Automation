import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import governanceClient from '../src/lib/governance-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('evaluateServer', () => {
  it('posts to governance-service /violations/evaluate with the server_id', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await governanceClient.evaluateServer('srv-1');
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/violations/evaluate');
    expect(JSON.parse(opts.body)).toEqual({ server_id: 'srv-1' });
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('does not throw when governance-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(governanceClient.evaluateServer('srv-1')).resolves.toBeUndefined();
  });
});

describe('recordApprovalDecision', () => {
  it('posts to governance-service /approval-decisions with the expected shape', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await governanceClient.recordApprovalDecision({
      assetType: 'mcp_server', assetId: 'srv-1', decision: 'approved', actor: 'jane', role: 'admin', supportingEvidence: 'looks good',
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/approval-decisions');
    expect(JSON.parse(opts.body)).toEqual({
      asset_type: 'mcp_server', asset_id: 'srv-1', decision: 'approved', actor: 'jane', role: 'admin',
      supporting_evidence: 'looks good', expiration: null,
    });
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('does not throw when governance-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(governanceClient.recordApprovalDecision({ assetType: 'mcp_server', assetId: 'srv-1', decision: 'approved', actor: 'jane' })).resolves.toBeUndefined();
  });
});

describe('startApprovalChain', () => {
  it('posts to governance-service /approval-chains/requests with the expected shape', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: 'req-1', status: 'pending' }) });
    const result = await governanceClient.startApprovalChain({
      riskTier: 'critical', assetType: 'mcp_server', assetId: 'srv-1', requestedBy: 'jane', reason: 'new critical server',
    });
    expect(result).toEqual({ id: 'req-1', status: 'pending' });

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/approval-chains/requests');
    expect(JSON.parse(opts.body)).toEqual({
      risk_tier: 'critical', asset_type: 'mcp_server', asset_id: 'srv-1', requested_by: 'jane', reason: 'new critical server',
    });
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('resolves to null on a 404 (no active chain for this risk tier) — a legitimate outcome', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    const result = await governanceClient.startApprovalChain({ riskTier: 'low', assetType: 'mcp_server', assetId: 'srv-1', requestedBy: 'jane' });
    expect(result).toBeNull();
  });

  // Deliberately NOT fail-soft, unlike every other function in this file —
  // see the handler's own comment for why.
  it('throws (does not fail soft) when governance-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(governanceClient.startApprovalChain({ riskTier: 'critical', assetType: 'mcp_server', assetId: 'srv-1', requestedBy: 'jane' }))
      .rejects.toThrow('connection refused');
  });

  it('throws on a non-404 error status from governance-service', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(governanceClient.startApprovalChain({ riskTier: 'critical', assetType: 'mcp_server', assetId: 'srv-1', requestedBy: 'jane' }))
      .rejects.toThrow('500');
  });
});

describe('reportAgentConfusedDeputy', () => {
  it('posts to governance-service /violations/agent-security-event with the expected shape', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true });
    await governanceClient.reportAgentConfusedDeputy({
      agentId: 'agent-1', agentName: 'telemetry-agent', delegatedForUserId: 'user-a', actingForUserId: 'user-b',
    });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/violations/agent-security-event');
    const body = JSON.parse(opts.body);
    expect(body.agent_id).toBe('agent-1');
    expect(body.rule_type).toBe('agent_confused_deputy');
    expect(body.message).toContain('user-a');
    expect(body.message).toContain('user-b');
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('does not throw when governance-service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(governanceClient.reportAgentConfusedDeputy({
      agentId: 'agent-1', agentName: 'x', delegatedForUserId: 'user-a', actingForUserId: 'user-b',
    })).resolves.toBeUndefined();
  });
});
