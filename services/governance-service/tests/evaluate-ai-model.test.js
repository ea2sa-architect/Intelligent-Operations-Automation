import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../db.js';
import { evaluateAiModel } from '../src/lib/rule-evaluator.js';

const MODEL = { id: 'model-1', name: 'gpt-x', provider: 'openai', is_sanctioned: false };
const POLICY = { id: 'policy-1', enforcement_mode: 'enforce' };
const RULE = { id: 'rule-1', severity: 'high', config_json: { require_sanctioned: 'true', max_data_classification: 'confidential' } };

beforeEach(() => vi.clearAllMocks());

describe('evaluateAiModel', () => {
  it('returns [] when the model does not exist', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await evaluateAiModel('nonexistent');
    expect(result).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('returns [] when the seed migration has not run (no policy found)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MODEL] })
      .mockResolvedValueOnce({ rows: [] }); // policy lookup
    const result = await evaluateAiModel(MODEL.id);
    expect(result).toEqual([]);
  });

  it('auto-binds the policy to the model on evaluation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MODEL] })
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })                    // binding insert
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] })                    // existing violations
      .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })        // violation insert
      .mockResolvedValueOnce({ rows: [] });                    // history insert

    await evaluateAiModel(MODEL.id, {});

    const bindCall = pool.query.mock.calls[2];
    expect(bindCall[0]).toContain('INSERT INTO policy_bindings');
    expect(bindCall[1]).toEqual([POLICY.id, MODEL.id]);
  });

  it('creates a violation for an unsanctioned model', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MODEL] })
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await evaluateAiModel(MODEL.id, {});

    const insertCall = pool.query.mock.calls[6];
    expect(insertCall[0]).toContain('INSERT INTO violations');
    expect(insertCall[1][4]).toMatch(/not sanctioned/i);
  });

  it('does not flag a sanctioned model with no data classification issue', async () => {
    const sanctioned = { ...MODEL, is_sanctioned: true };
    pool.query
      .mockResolvedValueOnce({ rows: [sanctioned] })
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] }); // existing violations — no insert follows

    const result = await evaluateAiModel(sanctioned.id, {});
    expect(result).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(6); // no violation insert, no history insert
  });

  it('flags a request whose data_classification exceeds the policy max', async () => {
    const sanctioned = { ...MODEL, is_sanctioned: true };
    pool.query
      .mockResolvedValueOnce({ rows: [sanctioned] })
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] }) // max_data_classification: confidential
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await evaluateAiModel(sanctioned.id, { dataClassification: 'restricted' });

    const insertCall = pool.query.mock.calls[6];
    expect(insertCall[1][4]).toMatch(/restricted.*exceeding.*confidential/i);
  });

  it('does not flag a request whose data_classification is within the policy max', async () => {
    const sanctioned = { ...MODEL, is_sanctioned: true };
    pool.query
      .mockResolvedValueOnce({ rows: [sanctioned] })
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] });

    const result = await evaluateAiModel(sanctioned.id, { dataClassification: 'internal' });
    expect(result).toEqual([]);
  });

  it('resolves a previously open violation when the condition clears', async () => {
    const sanctioned = { ...MODEL, is_sanctioned: true };
    pool.query
      .mockResolvedValueOnce({ rows: [sanctioned] })
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [{ id: 'v-old', message: 'Model "gpt-x" (provider: openai) is not sanctioned', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] }) // resolve UPDATE
      .mockResolvedValueOnce({ rows: [] }); // history insert

    const result = await evaluateAiModel(sanctioned.id, {});
    expect(result).toEqual([]);
    const resolveCall = pool.query.mock.calls[6];
    expect(resolveCall[0]).toContain("SET status = 'resolved'");
  });
});
