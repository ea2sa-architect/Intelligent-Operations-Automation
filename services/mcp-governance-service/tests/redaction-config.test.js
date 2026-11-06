import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import pool from '../db.js';
import redactionConfig from '../src/lib/redaction-config.js';

beforeEach(() => vi.clearAllMocks());

describe('loadEnabledExtraPatterns', () => {
  it('compiles enabled patterns into a name -> RegExp map', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ name: 'internal_token', pattern: 'internal-[a-f0-9]{16}' }] });
    const patterns = await redactionConfig.loadEnabledExtraPatterns();
    expect(patterns.internal_token).toBeInstanceOf(RegExp);
  });

  it('skips a pattern that fails to compile rather than throwing', async () => {
    pool.query.mockResolvedValueOnce({ rows: [
      { name: 'bad', pattern: 'foo-(unterminated' },
      { name: 'good', pattern: 'bar-[0-9]+' },
    ] });
    const patterns = await redactionConfig.loadEnabledExtraPatterns();
    expect(patterns.bad).toBeUndefined();
    expect(patterns.good).toBeInstanceOf(RegExp);
  });

  it('queries only enabled patterns', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await redactionConfig.loadEnabledExtraPatterns();
    expect(pool.query.mock.calls[0][0]).toContain('enabled = true');
  });
});
