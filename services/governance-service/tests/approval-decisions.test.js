import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Default mock identity is a service-key caller (mcp-governance-service's
// governance-client.js is the real primary caller of this route) so the
// existing tests below — which assert the request body's actor/role is
// persisted as-is — keep exercising that legitimate, trusted path. The
// dedicated 'S2.9 identity binding' describe block overrides this per-test
// to exercise the human-session case.
vi.mock('../src/lib/require-auth.js', () => ({
  default: vi.fn((req, _res, next) => { req.user = { id: 'internal-service', isService: true }; next(); }),
  requirePermission: () => (_req, _res, next) => next(),
}));
import pool from '../db.js';
import requireAuth from '../src/lib/require-auth.js';
import app from '../index.js';

const DECISION = {
  id: 'dddddddd-0000-0000-0000-000000000001',
  asset_type: 'mcp_server', asset_id: 'srv-1', decision: 'approved',
  actor: 'jane', role: 'admin', supporting_evidence: null, expiration: null,
  decided_at: '2026-07-19T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('POST /approval-decisions', () => {
  it('records a decision', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DECISION] });
    const res = await request(app)
      .post('/approval-decisions')
      .send({ asset_type: 'mcp_server', asset_id: 'srv-1', decision: 'approved', actor: 'jane', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.decision).toBe('approved');
    expect(pool.query.mock.calls[0][1]).toEqual(['mcp_server', 'srv-1', 'approved', 'jane', 'admin', null, null]);
  });

  it('rejects a missing required field', async () => {
    const res = await request(app).post('/approval-decisions').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
    expect(res.status).toBe(400);
  });
});

// S2.9 (2026-10-08, finding F-04) — a human session calling this route
// directly must not be able to claim an arbitrary actor/role; only a
// service-key caller's claimed actor/role is trusted (it already derived it
// from the real human it authenticated).
describe('POST /approval-decisions — S2.9 identity binding', () => {
  it('overrides a human-session caller\'s claimed actor/role with their own identity', async () => {
    requireAuth.mockImplementationOnce((req, _res, next) => {
      req.user = { id: 'user-2', username: 'real-approver', roles: ['governance-officer'] };
      next();
    });
    pool.query.mockResolvedValueOnce({ rows: [DECISION] });

    await request(app)
      .post('/approval-decisions')
      .send({ asset_type: 'mcp_server', asset_id: 'srv-1', decision: 'approved', actor: 'someone-else', role: 'platform-admin' });

    expect(pool.query.mock.calls[0][1]).toEqual(['mcp_server', 'srv-1', 'approved', 'real-approver', 'governance-officer', null, null]);
  });

  it('trusts the service-key caller\'s claimed actor/role as-is', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DECISION] });
    await request(app)
      .post('/approval-decisions')
      .send({ asset_type: 'mcp_server', asset_id: 'srv-1', decision: 'approved', actor: 'jane', role: 'admin' });

    expect(pool.query.mock.calls[0][1]).toEqual(['mcp_server', 'srv-1', 'approved', 'jane', 'admin', null, null]);
  });
});

describe('GET /approval-decisions', () => {
  it('lists decisions, most recent first', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DECISION] });
    const res = await request(app).get('/approval-decisions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY decided_at DESC');
  });

  it('filters by asset_type and asset_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/approval-decisions?asset_type=mcp_server&asset_id=srv-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('asset_type');
    expect(sql).toContain('asset_id');
    expect(params).toEqual(['mcp_server', 'srv-1']);
  });

  // EP-103-S7 — unified server history tab: server + all its tools/prompts
  // in one call, since they span different asset_ids (and usually asset_types).
  it('filters by a comma-separated asset_ids list, ignoring asset_type', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/approval-decisions?asset_ids=srv-1,tool-1,tool-2');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('asset_id = ANY($1::text[])');
    expect(params).toEqual([['srv-1', 'tool-1', 'tool-2']]);
  });
});
