import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import approvalChainEngine from '../src/lib/approval-chain-engine.js';

const SEQUENTIAL_CHAIN_FIELDS = {
  chain_id: 'chain-1', chain_name: 'Critical MCP Approval', execution_mode: 'sequential',
  stages: [
    { order: 1, approver_role: 'security_lead', quorum: 1 },
    { order: 2, approver_role: 'admin', quorum: 2 },
  ],
};
const PARALLEL_CHAIN_FIELDS = {
  chain_id: 'chain-2', chain_name: 'Parallel Approval', execution_mode: 'parallel',
  stages: [
    { order: 1, approver_role: 'security_lead', quorum: 1 },
    { order: 2, approver_role: 'admin', quorum: 1 },
  ],
};

function pendingRequest(overrides) {
  return {
    id: 'req-1', status: 'pending', current_stage: 1, requested_by: 'alice',
    asset_type: 'mcp_server', asset_id: 'srv-1',
    ...SEQUENTIAL_CHAIN_FIELDS, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
});
afterEach(() => vi.restoreAllMocks());

describe('findActiveChainForRiskTier', () => {
  it('selects an active chain for the given risk tier', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'chain-1', risk_tier: 'critical' }] });
    const chain = await approvalChainEngine.findActiveChainForRiskTier('critical');
    expect(chain).toEqual({ id: 'chain-1', risk_tier: 'critical' });
    expect(pool.query.mock.calls[0][0]).toContain("status = 'active'");
  });

  it('returns null when none found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const chain = await approvalChainEngine.findActiveChainForRiskTier('low');
    expect(chain).toBeNull();
  });
});

describe('recordDecision', () => {
  it('rejects when the request is already decided', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ status: 'approved' })] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 1, actor: 'bob', actorRoles: ['security_lead'], decision: 'approved',
    })).rejects.toMatchObject({ status: 409 });
  });

  it('rejects when the approver is the requester', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest()] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 1, actor: 'alice', actorRoles: ['security_lead'], decision: 'approved',
    })).rejects.toMatchObject({ status: 403, message: expect.stringContaining('different from the requester') });
  });

  it("rejects when the actor lacks the stage's required role", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest()] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 1, actor: 'bob', actorRoles: ['admin'], decision: 'approved',
    })).rejects.toMatchObject({ status: 403, message: expect.stringContaining("requires the 'security_lead' role") });
  });

  it('rejects a decision on a stage that is not yet open (sequential)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ current_stage: 1 })] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 2, actor: 'bob', actorRoles: ['admin'], decision: 'approved',
    })).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not yet open') });
  });

  it('a single rejection ends the whole request, regardless of stage', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest()] })          // getRequestDetail select
      .mockResolvedValueOnce({ rows: [] })                            // existing decisions
      .mockResolvedValueOnce({ rows: [] })                            // insert decision
      .mockResolvedValueOnce({ rows: [{ id: 'req-1', status: 'rejected' }] }); // update

    const result = await approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 1, actor: 'bob', actorRoles: ['security_lead'], decision: 'rejected', reason: 'too risky',
    });
    expect(result.status).toBe('rejected');

    const insertArgs = pool.query.mock.calls[2][1];
    expect(insertArgs).toEqual(['req-1', 1, 'bob', 'rejected', 'too risky']);
    expect(global.fetch).toHaveBeenCalledTimes(1); // notifyAsset fired
  });

  it('stays pending when a stage quorum of >1 is not yet fully met', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ current_stage: 2 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [{ stage_order: 2, actor: 'carol', decision: 'approved' }] }); // only 1 of 2 needed

    const result = await approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 2, actor: 'carol', actorRoles: ['admin'], decision: 'approved',
    });
    expect(result.status).toBe('pending');
    expect(pool.query).toHaveBeenCalledTimes(4); // no UPDATE issued yet
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('advances current_stage once a non-final stage reaches quorum (sequential)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ current_stage: 1 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [{ stage_order: 1, actor: 'bob', decision: 'approved' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'req-1', status: 'pending', current_stage: 2 }] }); // advance update

    const result = await approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 1, actor: 'bob', actorRoles: ['security_lead'], decision: 'approved',
    });
    expect(result.current_stage).toBe(2);
    expect(pool.query.mock.calls[4][0]).toContain('SET current_stage');
    expect(global.fetch).not.toHaveBeenCalled(); // not a terminal decision yet
  });

  it('approves the request once the final stage reaches quorum (sequential) and notifies the asset', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ current_stage: 2 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [
        { stage_order: 2, actor: 'carol', decision: 'approved' },
        { stage_order: 2, actor: 'dave', decision: 'approved' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'req-1', status: 'approved' }] });

    const result = await approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 2, actor: 'dave', actorRoles: ['admin'], decision: 'approved',
    });
    expect(result.status).toBe('approved');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('/servers/srv-1/approval-chain-decided');
    expect(JSON.parse(opts.body)).toEqual({ request_id: 'req-1', decision: 'approved' });
  });

  it('parallel mode only completes once every stage independently reaches quorum', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ ...PARALLEL_CHAIN_FIELDS, current_stage: 1 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // insert
      // only stage 1 has an approval so far — stage 2 still unmet
      .mockResolvedValueOnce({ rows: [{ stage_order: 1, actor: 'bob', decision: 'approved' }] });

    const result = await approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 1, actor: 'bob', actorRoles: ['security_lead'], decision: 'approved',
    });
    expect(result.status).toBe('pending');
    expect(pool.query).toHaveBeenCalledTimes(4); // no completion UPDATE
  });

  it('parallel mode completes once the last outstanding stage reaches quorum', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [pendingRequest({ ...PARALLEL_CHAIN_FIELDS, current_stage: 1 })] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }) // insert
      .mockResolvedValueOnce({ rows: [
        { stage_order: 1, actor: 'bob', decision: 'approved' },
        { stage_order: 2, actor: 'carol', decision: 'approved' },
      ] })
      .mockResolvedValueOnce({ rows: [{ id: 'req-1', status: 'approved' }] });

    const result = await approvalChainEngine.recordDecision({
      requestId: 'req-1', stageOrder: 2, actor: 'carol', actorRoles: ['admin'], decision: 'approved',
    });
    expect(result.status).toBe('approved');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('returns null for an unknown request', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await approvalChainEngine.recordDecision({
      requestId: 'does-not-exist', stageOrder: 1, actor: 'bob', actorRoles: ['admin'], decision: 'approved',
    });
    expect(result).toBeNull();
  });
});
