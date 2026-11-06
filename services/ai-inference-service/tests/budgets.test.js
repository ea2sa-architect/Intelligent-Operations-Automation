import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

const BUDGET = {
  id: 'dddddddd-0000-0000-0000-000000000001',
  scope_type: 'user_id',
  scope_value: 'team-x',
  period: 'monthly',
  limit_usd: '100.000000',
  mode: 'soft',
  status: 'active',
  created_at: '2026-08-03T00:00:00Z',
  updated_at: '2026-08-03T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /budgets', () => {
  it('returns active budgets by default', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BUDGET] });
    const res = await request(app).get('/budgets');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain('status = $1');
    expect(pool.query.mock.calls[0][1]).toEqual(['active']);
  });

  it('returns archived budgets when ?status=archived', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/budgets?status=archived');
    expect(pool.query.mock.calls[0][1]).toEqual(['archived']);
  });
});

describe('POST /budgets', () => {
  it('creates a budget', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BUDGET] });
    const res = await request(app).post('/budgets').send({
      scope_type: 'user_id', scope_value: 'team-x', period: 'monthly', limit_usd: 100, mode: 'soft',
    });
    expect(res.status).toBe(201);
    expect(res.body.scope_value).toBe('team-x');
  });

  it('rejects an invalid scope_type with 400 before querying the DB', async () => {
    const res = await request(app).post('/budgets').send({
      scope_type: 'id', scope_value: 'x', period: 'monthly', limit_usd: 100, mode: 'soft',
    });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects an invalid period with 400 before querying the DB', async () => {
    const res = await request(app).post('/budgets').send({
      scope_type: 'user_id', scope_value: 'x', period: 'weekly', limit_usd: 100, mode: 'soft',
    });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects an invalid mode with 400 before querying the DB', async () => {
    const res = await request(app).post('/budgets').send({
      scope_type: 'user_id', scope_value: 'x', period: 'monthly', limit_usd: 100, mode: 'strict',
    });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('rejects a missing limit_usd with 400', async () => {
    const res = await request(app).post('/budgets').send({
      scope_type: 'user_id', scope_value: 'x', period: 'monthly', mode: 'soft',
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /budgets/:id', () => {
  it('updates limit_usd and mode', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...BUDGET, limit_usd: '200.000000', mode: 'hard' }] });
    const res = await request(app).put(`/budgets/${BUDGET.id}`).send({ limit_usd: 200, mode: 'hard' });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('hard');
  });

  it('ignores an attempt to change scope_type — not passed to the query at all', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BUDGET] });
    await request(app).put(`/budgets/${BUDGET.id}`).send({ scope_type: 'model_id', limit_usd: 50 });
    // scope_type must not appear anywhere in the UPDATE's column list
    expect(pool.query.mock.calls[0][0]).not.toMatch(/scope_type\s*=/);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/budgets/does-not-exist').send({ limit_usd: 50 });
    expect(res.status).toBe(404);
  });

  it('rejects an invalid mode with 400 before querying the DB', async () => {
    const res = await request(app).put(`/budgets/${BUDGET.id}`).send({ mode: 'strict' });
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });
});

// PATCH, not DELETE — Kong's route for this service only allows
// GET/POST/PUT/PATCH (bootstrap/platform.config.yaml), and this never
// actually deletes the row anyway (D1). Found via real browser
// verification (a Kong 404), not assumed.
describe('PATCH /budgets/:id/archive', () => {
  it("archives (status update), not a hard delete — UPDATE, not DELETE FROM", async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...BUDGET, status: 'archived' }] });
    const res = await request(app).patch(`/budgets/${BUDGET.id}/archive`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('archived');
    expect(pool.query.mock.calls[0][0]).toMatch(/^\s*UPDATE/i);
    expect(pool.query.mock.calls[0][0]).not.toMatch(/DELETE FROM/i);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/budgets/does-not-exist/archive');
    expect(res.status).toBe(404);
  });
});
