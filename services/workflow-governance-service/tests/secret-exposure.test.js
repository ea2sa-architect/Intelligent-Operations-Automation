import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/cache.js', () => ({
  default: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), TTL: { METADATA: 300, RISK: 3600, LIST: 300 } },
}));
vi.mock('../src/lib/n8n-client.js', () => ({
  default: { listWorkflows: vi.fn(), getWorkflow: vi.fn(), getExecutions: vi.fn(), listProjects: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/lib/mcp-governance-client.js', () => ({
  default: { resolveServerReference: vi.fn().mockResolvedValue({ registered: false }), fetchServerDetail: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));

import pool from '../db.js';
import cache from '../src/lib/cache.js';
import n8nClient from '../src/lib/n8n-client.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('PATCH /workflows/secret-exposure/:id/confirm-rotation', () => {
  it('records who confirmed the rotation and invalidates the cached workflow detail', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'se1', workflow_id: 'wf-abc', rotation_confirmed_by: 'jane@example.com', rotation_confirmed_at: '2026-07-18T00:00:00Z' }],
    });
    const res = await request(app).patch('/workflows/secret-exposure/se1/confirm-rotation').send({ confirmed_by: 'jane@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.rotation_confirmed_by).toBe('jane@example.com');
    expect(pool.query.mock.calls[0][1]).toEqual(['jane@example.com', 'se1']);
    // GET /workflows/:id caches its response — without this, the SPA would
    // keep showing pre-confirmation state until the cache TTL lapses.
    expect(cache.del).toHaveBeenCalledWith('workflow:wf-abc');
  });

  it('rejects a missing confirmed_by', async () => {
    const res = await request(app).patch('/workflows/secret-exposure/se1/confirm-rotation').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown finding', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/workflows/secret-exposure/unknown/confirm-rotation').send({ confirmed_by: 'jane@example.com' });
    expect(res.status).toBe(404);
  });
});

// EP-101-S9 — a credential claimed as rotated that's detected again (same
// fingerprint) on a later discover/import must keep showing its
// rotation-confirmed state, since that's the signal the claim didn't hold.
describe('POST /workflows/discover — secret exposure rotation carry-forward', () => {
  it('carries forward rotation_confirmed_at/by when the same fingerprint reappears', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const crypto = await import('crypto');
    const fingerprint = crypto.createHash('sha256').update(rawKey).digest('hex');

    const n8nWorkflow = {
      id: 'wf-leak', name: 'Leaky', active: true, connections: {}, settings: {},
      nodes: [{ id: 'n1', name: 'HTTP', type: 'n8n-nodes-base.httpRequest', parameters: { headers: { Authorization: `Bearer ${rawKey}` } }, credentials: {} }],
    };
    n8nClient.listWorkflows.mockResolvedValueOnce([{ id: 'wf-leak', name: 'Leaky', active: true }]);
    n8nClient.getWorkflow.mockResolvedValueOnce(n8nWorkflow);

    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT fingerprint_sha256') && sql.includes('workflow_secret_exposure')) {
        return Promise.resolve({ rows: [{ fingerprint_sha256: fingerprint, rotation_confirmed_at: '2026-07-01T00:00:00Z', rotation_confirmed_by: 'jane@example.com' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/workflows/discover');
    expect(res.status).toBe(202);

    const insertCall = pool.query.mock.calls.find(c =>
      c[0].includes('INSERT INTO workflow_governance.workflow_secret_exposure') && c[1][4] === fingerprint
    );
    expect(insertCall[1]).toEqual(['wf-leak', 'openai_key', 'HTTP', expect.any(String), fingerprint, '2026-07-01T00:00:00Z', 'jane@example.com']);
  });
});
