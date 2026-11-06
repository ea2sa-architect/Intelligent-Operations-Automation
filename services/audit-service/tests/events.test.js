import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own
// dedicated conformance suite (tests/require-auth.test.js). Default mock
// identity is a service-key caller (the real, primary caller of POST /events
// across every other service's audit-client.js) so the existing tests below
// keep exercising that legitimate, trusted path. The dedicated 'S2.9 identity
// binding' describe block overrides this per-test for the human-session case.
vi.mock('../src/lib/require-auth.js', () => ({
  default: vi.fn((req, _res, next) => { req.user = { id: 'internal-service', isService: true }; next(); }),
  requirePermission: () => (_req, _res, next) => next(),
}));
import pool from '../db.js';
import requireAuth from '../src/lib/require-auth.js';
import app from '../index.js';

const EVENT = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  event_type: 'policy.evaluated',
  actor_id: 'user-1',
  actor_type: 'user',
  resource_type: 'policy',
  resource_id: 'policy-1',
  action: 'evaluate',
  outcome: 'allow',
  metadata_json: null,
  created_at: '2026-05-11T00:00:00Z',
};

const VALID_EVENT = {
  event_type: 'policy.evaluated',
  actor_id: 'user-1',
  actor_type: 'user',
  resource_type: 'policy',
  resource_id: 'policy-1',
  action: 'evaluate',
  outcome: 'allow',
};

beforeEach(() => vi.clearAllMocks());

describe('POST /events', () => {
  it('records an audit event', async () => {
    pool.query.mockResolvedValueOnce({ rows: [EVENT] });
    const res = await request(app).post('/events').send(VALID_EVENT);
    expect(res.status).toBe(201);
    expect(res.body.event_type).toBe('policy.evaluated');
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).post('/events').send({ event_type: 'policy.evaluated' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('returns 500 on DB error', async () => {
    pool.query.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app).post('/events').send(VALID_EVENT);
    expect(res.status).toBe(500);
  });
});

// S2.9 (2026-10-08, finding F-04) — a human session (platform-admin/admin —
// the only named roles granted audit:write) calling this route directly
// must not be able to claim an arbitrary actor_id/actor_type; only a
// service-key caller's claimed actor is trusted (it already derived it from
// the real human/service it authenticated, e.g. auth-service's audit-client.js).
describe('POST /events — S2.9 identity binding', () => {
  it('overrides a human-session caller\'s claimed actor_id/actor_type with their own identity', async () => {
    requireAuth.mockImplementationOnce((req, _res, next) => {
      req.user = { id: 'admin-user-1', username: 'platform-admin-1', isService: false };
      next();
    });
    pool.query.mockResolvedValueOnce({ rows: [EVENT] });

    await request(app).post('/events').send({ ...VALID_EVENT, actor_id: 'someone-else', actor_type: 'service' });

    const params = pool.query.mock.calls[0][1];
    expect(params[1]).toBe('admin-user-1'); // actor_id
    expect(params[2]).toBe('user');         // actor_type
  });

  it('trusts the service-key caller\'s claimed actor_id/actor_type as-is', async () => {
    pool.query.mockResolvedValueOnce({ rows: [EVENT] });
    await request(app).post('/events').send(VALID_EVENT);
    const params = pool.query.mock.calls[0][1];
    expect(params[1]).toBe('user-1');
    expect(params[2]).toBe('user');
  });
});

describe('GET /events', () => {
  it('returns list of audit events', async () => {
    pool.query.mockResolvedValueOnce({ rows: [EVENT] });
    const res = await request(app).get('/events');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by actor_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/events?actor_id=user-1');
    expect(pool.query.mock.calls[0][0]).toContain('actor_id');
  });

  it('filters by resource_type', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/events?resource_type=policy');
    expect(pool.query.mock.calls[0][0]).toContain('resource_type');
  });

  it('filters by time range', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/events?from=2026-05-01T00:00:00Z&to=2026-05-12T00:00:00Z');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('created_at >=');
    expect(sql).toContain('created_at <=');
  });

  it('caps limit at 500', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/events?limit=99999');
    const params = pool.query.mock.calls[0][1];
    expect(params[params.length - 2]).toBe(500);
  });
});

describe('GET /events/:id', () => {
  it('returns the event', async () => {
    pool.query.mockResolvedValueOnce({ rows: [EVENT] });
    const res = await request(app).get(`/events/${EVENT.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(EVENT.id);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/events/does-not-exist');
    expect(res.status).toBe(404);
  });
});
