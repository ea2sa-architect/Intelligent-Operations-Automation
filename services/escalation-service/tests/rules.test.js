import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

const RULE = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'High CPU Alert',
  condition_json: { metric: 'cpu', threshold: 90 },
  severity: 'high',
  channels_json: ['email'],
  enabled: true,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /rules', () => {
  it('returns list of escalation rules', async () => {
    pool.query.mockResolvedValueOnce({ rows: [RULE] });
    const res = await request(app).get('/rules');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by severity', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/rules?severity=critical');
    expect(pool.query.mock.calls[0][0]).toContain('severity');
  });

  it('filters by enabled', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/rules?enabled=true');
    expect(pool.query.mock.calls[0][0]).toContain('enabled');
  });
});

describe('GET /rules/:id', () => {
  it('returns the rule', async () => {
    pool.query.mockResolvedValueOnce({ rows: [RULE] });
    const res = await request(app).get(`/rules/${RULE.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(RULE.id);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/rules/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /rules', () => {
  it('creates a rule', async () => {
    pool.query.mockResolvedValueOnce({ rows: [RULE] });
    const res = await request(app).post('/rules').send({
      name: 'High CPU Alert',
      condition_json: { metric: 'cpu', threshold: 90 },
      severity: 'high',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('High CPU Alert');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/rules').send({ condition_json: {}, severity: 'high' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when condition_json is missing', async () => {
    const res = await request(app).post('/rules').send({ name: 'Rule', severity: 'high' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when severity is missing', async () => {
    const res = await request(app).post('/rules').send({ name: 'Rule', condition_json: {} });
    expect(res.status).toBe(400);
  });
});

describe('PUT /rules/:id', () => {
  it('updates the rule', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...RULE, enabled: false }] });
    const res = await request(app).put(`/rules/${RULE.id}`).send({ enabled: false });
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/rules/does-not-exist').send({ enabled: false });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /rules/:id', () => {
  it('deletes the rule', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete(`/rules/${RULE.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/rules/does-not-exist');
    expect(res.status).toBe(404);
  });
});
