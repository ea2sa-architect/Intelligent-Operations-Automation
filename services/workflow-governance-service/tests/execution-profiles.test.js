import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/cache.js', () => ({
  default: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), TTL: { METADATA: 300, RISK: 3600, LIST: 300 } },
}));
// This route needs req.user.username (requested_by/approved_by) — unlike
// most route tests in this service, which bypass auth with no req.user at
// all, since they never read it. Same override pattern mcp-governance-
// service's telemetry-route.test.js already established for this exact need.
vi.mock('../src/lib/require-auth.js', () => ({
  default: (req, _res, next) => { req.user = { id: 'user-1', username: 'jane@example.com' }; next(); },
  requirePermission: () => (_req, _res, next) => next(),
}));

import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('POST /workflows/:id/execution-profile', () => {
  it('requires a non-empty scenarios array', async () => {
    const res = await request(app).post('/workflows/wf-1/execution-profile').send({});
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('404s when the workflow does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/wf-1/execution-profile').send({ scenarios: [{ name: 'x', payload_json: {} }] });
    expect(res.status).toBe(404);
  });

  it('422s when the workflow has no Webhook trigger node — the "supported trigger" gate', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'wf-1' }] })
      .mockResolvedValueOnce({ rows: [] }); // no webhook node found
    const res = await request(app).post('/workflows/wf-1/execution-profile').send({ scenarios: [{ name: 'x', payload_json: {} }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no Webhook trigger node/);
  });

  it('creates a pending_review profile, recording who requested it', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'wf-1' }] })
      .mockResolvedValueOnce({ rows: [{ node_name: 'My Webhook' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1', status: 'pending_review' }] });

    const res = await request(app).post('/workflows/wf-1/execution-profile').send({
      scenarios: [{ name: 'happy path', payload_json: { foo: 'bar' } }],
    });

    expect(res.status).toBe(201);
    const [, params] = pool.query.mock.calls[2];
    expect(params).toEqual(['wf-1', 'My Webhook', JSON.stringify([{ name: 'happy path', payload_json: { foo: 'bar' } }]), 'jane@example.com']);
  });
});

describe('PATCH /workflows/:id/execution-profile/:profileId/approval', () => {
  it('rejects an invalid decision value', async () => {
    const res = await request(app).patch('/workflows/wf-1/execution-profile/profile-1/approval').send({ decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('approves, recording who approved it', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'profile-1', status: 'approved' }] });
    const res = await request(app).patch('/workflows/wf-1/execution-profile/profile-1/approval').send({ decision: 'approved' });
    expect(res.status).toBe(200);
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain("SET status = $1");
    expect(params[0]).toBe('approved');
    expect(params[1]).toBe('jane@example.com');
  });

  it('404s when the profile does not exist for that workflow', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/workflows/wf-1/execution-profile/nope/approval').send({ decision: 'rejected', reason: 'not safe' });
    expect(res.status).toBe(404);
  });
});

describe('GET /workflows/:id/execution-profile', () => {
  it('returns the approved profile with a constructed webhook_url when one exists', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'profile-1', status: 'approved', webhook_node_name: 'My Webhook' }] })
      .mockResolvedValueOnce({ rows: [{ parameters_json: { path: 'abc-123' } }] });

    const res = await request(app).get('/workflows/wf-1/execution-profile');

    expect(res.status).toBe(200);
    expect(res.body.webhook_url).toContain('/webhook/abc-123');
  });

  it('falls back to the latest pending/rejected profile when none is approved', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] }) // no approved
      .mockResolvedValueOnce({ rows: [{ id: 'profile-2', status: 'rejected' }] });

    const res = await request(app).get('/workflows/wf-1/execution-profile');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
  });

  it('404s when there is no profile at all', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/workflows/wf-1/execution-profile');
    expect(res.status).toBe(404);
  });
});
