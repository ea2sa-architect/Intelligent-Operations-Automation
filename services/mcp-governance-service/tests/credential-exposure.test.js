import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('PATCH /credential-exposure/:id/confirm-rotation', () => {
  it('records who confirmed the rotation and when', async () => {
    pool.query.mockResolvedValueOnce({
      rows: [{ id: 'ce1', rotation_confirmed_by: 'jane@example.com', rotation_confirmed_at: '2026-07-18T00:00:00Z' }],
    });
    const res = await request(app).patch('/credential-exposure/ce1/confirm-rotation').send({ confirmed_by: 'jane@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.rotation_confirmed_by).toBe('jane@example.com');
    const updateArgs = pool.query.mock.calls[0][1];
    expect(updateArgs).toEqual(['jane@example.com', 'ce1']);
  });

  it('rejects a missing confirmed_by', async () => {
    const res = await request(app).patch('/credential-exposure/ce1/confirm-rotation').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown finding', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/credential-exposure/unknown/confirm-rotation').send({ confirmed_by: 'jane@example.com' });
    expect(res.status).toBe(404);
  });
});
