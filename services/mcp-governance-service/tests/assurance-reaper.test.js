import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import assuranceReaper from '../src/lib/assurance-reaper.js';

beforeEach(() => vi.clearAllMocks());

describe('expireStaleEvidence', () => {
  it('flips validated evidence past its expiration to expired', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 2 });
    await assuranceReaper.expireStaleEvidence();
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("SET status = 'expired'");
    expect(sql).toContain("status = 'validated'");
    expect(sql).toContain('expires_at < NOW()');
  });
});
