import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/containment-client.js', () => ({
  default: { applyContainment: vi.fn(), rollbackTool: vi.fn() },
}));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import containmentClient from '../src/lib/containment-client.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('POST /assets/:type/:id/suspend', () => {
  it('applies containment then writes an audit entry, in that order', async () => {
    containmentClient.applyContainment.mockResolvedValueOnce({ id: 'srv-1' });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'log-1', action: 'suspend' }] });

    const res = await request(app).post('/assets/mcp_server/srv-1/suspend').send({ reason: 'Suspicious outbound traffic' });
    expect(res.status).toBe(201);
    expect(res.body.action).toBe('suspend');

    expect(containmentClient.applyContainment).toHaveBeenCalledWith('mcp_server', 'srv-1', 'suspended');
    expect(pool.query.mock.calls[0][1]).toEqual(['mcp_server', 'srv-1', 'suspend', 'unknown', 'Suspicious outbound traffic']);
  });

  it('requires a reason', async () => {
    const res = await request(app).post('/assets/mcp_server/srv-1/suspend').send({});
    expect(res.status).toBe(400);
    expect(containmentClient.applyContainment).not.toHaveBeenCalled();
  });

  it('rejects an unknown asset type', async () => {
    const res = await request(app).post('/assets/bogus/srv-1/suspend').send({ reason: 'x' });
    expect(res.status).toBe(400);
  });

  // The kill switch must not report success when it didn't happen.
  it('does NOT write an audit entry when the callback fails', async () => {
    containmentClient.applyContainment.mockRejectedValueOnce(new Error('Containment callback failed: 500 internal error'));

    const res = await request(app).post('/assets/mcp_server/srv-1/suspend').send({ reason: 'x' });
    expect(res.status).toBe(502);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

describe('POST /assets/:type/:id/quarantine', () => {
  it('applies quarantine containment', async () => {
    containmentClient.applyContainment.mockResolvedValueOnce({ id: 'srv-1' });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'log-1', action: 'quarantine' }] });

    const res = await request(app).post('/assets/mcp_server/srv-1/quarantine').send({ reason: 'Confirmed compromise' });
    expect(res.status).toBe(201);
    expect(containmentClient.applyContainment).toHaveBeenCalledWith('mcp_server', 'srv-1', 'quarantined');
  });
});

describe('POST /assets/:type/:id/restore', () => {
  it('does not require a reason', async () => {
    containmentClient.applyContainment.mockResolvedValueOnce({ id: 'srv-1' });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'log-1', action: 'restore' }] });

    const res = await request(app).post('/assets/mcp_server/srv-1/restore').send({});
    expect(res.status).toBe(201);
    expect(containmentClient.applyContainment).toHaveBeenCalledWith('mcp_server', 'srv-1', 'active');
  });
});

describe('POST /assets/:type/:id/rollback', () => {
  it('rolls back a tool and records the result in detail_json', async () => {
    containmentClient.rollbackTool.mockResolvedValueOnce({ id: 'tool-1', approval_status: 'pending' });
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'log-1', action: 'rollback' }] });

    const res = await request(app).post('/assets/mcp_tool/tool-1/rollback').send({ reason: 'Reverting a bad deploy' });
    expect(res.status).toBe(201);
    expect(containmentClient.rollbackTool).toHaveBeenCalledWith('tool-1');

    // 'rollback' is a literal in the SQL text (not a bound param) —
    // params are [asset_type, asset_id, actor, reason, detail_json].
    const [sql, insertArgs] = pool.query.mock.calls[0];
    expect(sql).toContain("'rollback'");
    expect(insertArgs[0]).toBe('mcp_tool');
    expect(insertArgs[1]).toBe('tool-1');
    expect(JSON.parse(insertArgs[4])).toEqual({ id: 'tool-1', approval_status: 'pending' });
  });

  it('rejects rollback for asset types with no snapshot history', async () => {
    const res = await request(app).post('/assets/mcp_server/srv-1/rollback').send({ reason: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('mcp_tool');
    expect(containmentClient.rollbackTool).not.toHaveBeenCalled();
  });
});

describe('GET /assets/:type/:id/containment', () => {
  it('returns the current state and the audit log', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'suspended' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'log-1', action: 'suspend' }] });

    const res = await request(app).get('/assets/mcp_server/srv-1/containment');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ containment_state: 'suspended', log: [{ id: 'log-1', action: 'suspend' }] });
  });

  it('returns 404 for an unknown asset', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/assets/mcp_server/unknown/containment');
    expect(res.status).toBe(404);
  });
});
