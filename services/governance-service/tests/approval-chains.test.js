import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/approval-chain-engine.js', () => ({
  default: {
    findActiveChainForRiskTier: vi.fn(),
    startChainRequest: vi.fn(),
    getRequestDetail: vi.fn(),
    recordDecision: vi.fn(),
  },
}));
// Default mock identity is a service-key caller (mcp-governance-service
// starts chains on a human's behalf this way) so the existing
// requested_by-trust test below keeps exercising that legitimate path.
vi.mock('../src/lib/require-auth.js', () => ({
  default: vi.fn((req, _res, next) => { req.user = { id: 'internal-service', isService: true }; next(); }),
  requirePermission: () => (_req, _res, next) => next(),
}));
import pool from '../db.js';
import approvalChainEngine from '../src/lib/approval-chain-engine.js';
import requireAuth from '../src/lib/require-auth.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

const CHAIN = {
  id: 'chain-1', name: 'Critical MCP Approval', risk_tier: 'critical', execution_mode: 'sequential',
  stages: [{ order: 1, approver_role: 'admin', quorum: 1 }], status: 'active',
};

describe('POST /approval-chains', () => {
  it('creates a chain template', async () => {
    pool.query.mockResolvedValueOnce({ rows: [CHAIN] });
    const res = await request(app).post('/approval-chains').send({
      name: 'Critical MCP Approval', risk_tier: 'critical', stages: [{ order: 1, approver_role: 'admin', quorum: 1 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Critical MCP Approval');
  });

  it('rejects an invalid risk_tier', async () => {
    const res = await request(app).post('/approval-chains').send({ name: 'x', risk_tier: 'extreme', stages: [{ order: 1, approver_role: 'admin', quorum: 1 }] });
    expect(res.status).toBe(400);
  });

  it('rejects empty stages', async () => {
    const res = await request(app).post('/approval-chains').send({ name: 'x', risk_tier: 'high', stages: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('non-empty array');
  });

  it('rejects duplicate stage order values', async () => {
    const res = await request(app).post('/approval-chains').send({
      name: 'x', risk_tier: 'high',
      stages: [{ order: 1, approver_role: 'admin', quorum: 1 }, { order: 1, approver_role: 'security_lead', quorum: 1 }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('unique');
  });

  it('rejects a stage missing approver_role', async () => {
    const res = await request(app).post('/approval-chains').send({
      name: 'x', risk_tier: 'high', stages: [{ order: 1, quorum: 1 }],
    });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /approval-chains/:id/status', () => {
  it('deactivates a chain', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...CHAIN, status: 'inactive' }] });
    const res = await request(app).patch('/approval-chains/chain-1/status').send({ status: 'inactive' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('inactive');
  });

  it('returns 404 for an unknown chain', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/approval-chains/unknown/status').send({ status: 'inactive' });
    expect(res.status).toBe(404);
  });
});

describe('POST /approval-chains/requests', () => {
  it('starts a request by risk_tier lookup', async () => {
    approvalChainEngine.findActiveChainForRiskTier.mockResolvedValueOnce(CHAIN);
    approvalChainEngine.startChainRequest.mockResolvedValueOnce({ id: 'req-1', chain_id: 'chain-1', status: 'pending' });

    const res = await request(app).post('/approval-chains/requests').send({
      risk_tier: 'critical', asset_type: 'mcp_server', asset_id: 'srv-1', reason: 'new critical server',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('req-1');
    expect(approvalChainEngine.startChainRequest).toHaveBeenCalledWith({
      chainId: 'chain-1', assetType: 'mcp_server', assetId: 'srv-1', requestedBy: 'unknown', reason: 'new critical server',
    });
  });

  it('trusts an explicit requested_by in the body over req.user (service-to-service calls)', async () => {
    approvalChainEngine.findActiveChainForRiskTier.mockResolvedValueOnce(CHAIN);
    approvalChainEngine.startChainRequest.mockResolvedValueOnce({ id: 'req-1', chain_id: 'chain-1', status: 'pending' });

    await request(app).post('/approval-chains/requests').send({
      risk_tier: 'critical', asset_type: 'mcp_server', asset_id: 'srv-1', requested_by: 'jane',
    });
    expect(approvalChainEngine.startChainRequest).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: 'jane' }));
  });

  // S2.9 (2026-10-08, finding F-05) — a human session calling this route
  // directly must have requested_by forced to their own identity, closing
  // the self-approval loophole where one account with both mcp:register and
  // mcp:approve could set an arbitrary non-matching requested_by.
  it('overrides a human-session caller\'s claimed requested_by with their own identity', async () => {
    requireAuth.mockImplementationOnce((req, _res, next) => {
      req.user = { id: 'user-3', username: 'real-requester', isService: false };
      next();
    });
    approvalChainEngine.findActiveChainForRiskTier.mockResolvedValueOnce(CHAIN);
    approvalChainEngine.startChainRequest.mockResolvedValueOnce({ id: 'req-1', chain_id: 'chain-1', status: 'pending' });

    await request(app).post('/approval-chains/requests').send({
      risk_tier: 'critical', asset_type: 'mcp_server', asset_id: 'srv-1', requested_by: 'someone-else',
    });
    expect(approvalChainEngine.startChainRequest).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: 'real-requester' }));
  });

  it('returns 404 when no active chain matches the risk tier', async () => {
    approvalChainEngine.findActiveChainForRiskTier.mockResolvedValueOnce(null);
    const res = await request(app).post('/approval-chains/requests').send({ risk_tier: 'low', asset_type: 'mcp_server', asset_id: 'srv-1' });
    expect(res.status).toBe(404);
  });

  it('requires asset_type and asset_id', async () => {
    const res = await request(app).post('/approval-chains/requests').send({ risk_tier: 'critical' });
    expect(res.status).toBe(400);
  });
});

describe('POST /approval-chains/requests/:id/decisions', () => {
  it('records a decision and returns the updated request', async () => {
    approvalChainEngine.recordDecision.mockResolvedValueOnce({ id: 'req-1', status: 'approved' });
    const res = await request(app).post('/approval-chains/requests/req-1/decisions').send({ stage_order: 1, decision: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
  });

  it('returns 404 when the engine reports no such request', async () => {
    approvalChainEngine.recordDecision.mockResolvedValueOnce(null);
    const res = await request(app).post('/approval-chains/requests/unknown/decisions').send({ stage_order: 1, decision: 'approved' });
    expect(res.status).toBe(404);
  });

  it('surfaces an engine validation error with its status code', async () => {
    const err = new Error('The approver must be different from the requester');
    err.status = 403;
    approvalChainEngine.recordDecision.mockRejectedValueOnce(err);

    const res = await request(app).post('/approval-chains/requests/req-1/decisions').send({ stage_order: 1, decision: 'approved' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('different from the requester');
  });

  it('rejects an invalid decision value', async () => {
    const res = await request(app).post('/approval-chains/requests/req-1/decisions').send({ stage_order: 1, decision: 'maybe' });
    expect(res.status).toBe(400);
    expect(approvalChainEngine.recordDecision).not.toHaveBeenCalled();
  });
});
