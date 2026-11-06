import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('GET /health', () => {
  it('returns ok when DB is reachable', async () => {
    pool.query.mockResolvedValueOnce({});
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', service: 'ai-inference-service' });
  });

  it('returns 503 when DB is unreachable', async () => {
    pool.query.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
  });
});
