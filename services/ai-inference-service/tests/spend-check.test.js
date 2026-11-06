import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import spendCheck, { computePeriodStart, resolveScopeColumn } from '../src/lib/spend-check.js';

beforeEach(() => vi.clearAllMocks());

describe('computePeriodStart', () => {
  it('returns the start of the current UTC day for "daily"', () => {
    const now = new Date('2026-08-03T19:41:40Z');
    expect(computePeriodStart('daily', now).toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('returns the start of the current UTC month for "monthly"', () => {
    const now = new Date('2026-08-03T19:41:40Z');
    expect(computePeriodStart('monthly', now).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('does not roll over to the next month for a "monthly" period on the last day of the month', () => {
    const now = new Date('2026-08-31T23:59:59Z');
    expect(computePeriodStart('monthly', now).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('throws on an unrecognized period', () => {
    expect(() => computePeriodStart('weekly', new Date())).toThrow(/period/i);
  });
});

describe('resolveScopeColumn', () => {
  it.each(['model_id', 'user_id', 'service_id', 'workflow_id'])(
    'resolves %s to itself (the allowlisted column)',
    (scopeType) => {
      expect(resolveScopeColumn(scopeType)).toBe(scopeType);
    }
  );

  it('throws on a scope_type outside the allowlist', () => {
    expect(() => resolveScopeColumn('id')).toThrow(/scope_type/i);
  });

  it('throws rather than passing through arbitrary input as a column name', () => {
    // Guards against exactly the SQL-injection surface D2 exists to close.
    expect(() => resolveScopeColumn('id; DROP TABLE inference_requests;--')).toThrow();
  });
});

const BUDGET = {
  id: 'bbbbbbbb-0000-0000-0000-000000000001',
  scope_type: 'user_id',
  scope_value: 'team-x',
  period: 'monthly',
  limit_usd: '100.000000', // pg returns NUMERIC columns as strings
  mode: 'soft',
  status: 'active',
};

describe('checkBudget', () => {
  it('returns ok when spend is under the limit', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [BUDGET] })
      .mockResolvedValueOnce({ rows: [{ spent: '40.000000' }] });

    const result = await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: 'team-x' });

    expect(result).toEqual({ status: 'ok', budget: BUDGET, spent_usd: 40, limit_usd: 100 });
  });

  it('returns warn at 80% of the limit', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [BUDGET] })
      .mockResolvedValueOnce({ rows: [{ spent: '85.000000' }] });

    const result = await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: 'team-x' });
    expect(result.status).toBe('warn');
  });

  it('returns breach at or over the limit', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [BUDGET] })
      .mockResolvedValueOnce({ rows: [{ spent: '120.000000' }] });

    const result = await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: 'team-x' });
    expect(result.status).toBe('breach');
  });

  it('returns ok with a null budget when no budget is bound, without querying spend at all', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: 'team-y' });

    expect(result).toEqual({ status: 'ok', budget: null, spent_usd: 0, limit_usd: null });
    expect(pool.query).toHaveBeenCalledTimes(1); // short-circuits before the spend SUM query
  });

  it("scopes the spend query to the right column and the budget's period start", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [BUDGET] })
      .mockResolvedValueOnce({ rows: [{ spent: '10.000000' }] });

    await spendCheck.checkBudget({ scopeType: 'user_id', scopeValue: 'team-x' });

    const [spendQueryText, spendQueryParams] = pool.query.mock.calls[1];
    expect(spendQueryText).toContain('user_id');
    expect(spendQueryText).toContain('created_at >=');
    expect(spendQueryParams[0]).toBe('team-x');
    expect(spendQueryParams[1]).toEqual(computePeriodStart('monthly'));
  });

  it('rejects a scope_type outside the allowlist before querying anything', async () => {
    await expect(spendCheck.checkBudget({ scopeType: 'id', scopeValue: 'x' })).rejects.toThrow();
    expect(pool.query).not.toHaveBeenCalled();
  });
});
