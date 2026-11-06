import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/governance-client.js', () => ({ default: { evaluateServer: vi.fn(), recordApprovalDecision: vi.fn() } }));
import pool from '../db.js';
import governanceClient from '../src/lib/governance-client.js';
import approvalExpirationReaper from '../src/lib/approval-expiration-reaper.js';

beforeEach(() => vi.clearAllMocks());

describe('reevaluateExpiredApprovals', () => {
  it('does nothing when no approved server has passed its expiration_date', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const count = await approvalExpirationReaper.reevaluateExpiredApprovals();
    expect(count).toBe(0);
    expect(governanceClient.evaluateServer).not.toHaveBeenCalled();
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain("status = 'approved'");
    expect(sql).toContain('expiration_date IS NOT NULL');
    expect(sql).toContain('expiration_date < NOW()');
  });

  it('re-evaluates each server whose approval has expired', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'srv-1' }, { id: 'srv-2' }] });
    const count = await approvalExpirationReaper.reevaluateExpiredApprovals();
    expect(count).toBe(2);
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-2');
  });
});
