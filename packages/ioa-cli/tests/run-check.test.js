import { describe, it, expect, vi, afterEach } from 'vitest';
import { runCheckPipeline, exitCodeFor } from '../src/pipeline/run-check.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

function mockSequence(responses) {
  let i = 0;
  global.fetch = vi.fn(() => Promise.resolve(responses[i++]));
}

describe('runCheckPipeline', () => {
  it('resolves, evaluates, fetches coverage + open violations, and assembles the result', async () => {
    mockSequence([
      { ok: true, json: () => Promise.resolve({ id: 'wf-1', name: 'My Workflow' }) },                       // resolveWorkflow: GET /workflows/:id
      { ok: true, json: () => Promise.resolve({ workflow_id: 'wf-1', violations_created: 0 }) },              // POST /violations/evaluate
      { ok: true, json: () => Promise.resolve({ policies: [{ policy_id: 'p1', rules: [{ id: 'r1', evaluated_at: '2026-07-30T00:00:00Z' }] }] }) }, // GET /policy-bindings
      { ok: true, json: () => Promise.resolve([{ id: 'v1', severity: 'high', message: 'bad thing', policy_name: 'X' }]) }, // GET /violations
    ]);

    const result = await runCheckPipeline({ baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1' });

    expect(result.target).toEqual({ type: 'workflow', id: 'wf-1', name: 'My Workflow' });
    expect(result.register.status).toBe('already_tracked');
    expect(result.policy_coverage).toEqual({ applicable: 1, evaluated: 1, pct: 100, stale: [] });
    expect(result.violations.open).toHaveLength(1);
    expect(result.violations.by_severity.high).toBe(1);

    // evaluate call carries the resolved workflow id, not the raw target
    const [evalUrl, evalOpts] = global.fetch.mock.calls[1];
    expect(evalUrl).toContain('/violations/evaluate');
    expect(JSON.parse(evalOpts.body)).toEqual({ workflow_id: 'wf-1' });
  });
});

describe('exitCodeFor', () => {
  it('exits 0 when there are no open critical/high violations', () => {
    expect(exitCodeFor({ violations: { by_severity: { critical: 0, high: 0, medium: 3, low: 1 } } })).toBe(0);
  });

  it('exits 1 on any open high violation', () => {
    expect(exitCodeFor({ violations: { by_severity: { critical: 0, high: 1, medium: 0, low: 0 } } })).toBe(1);
  });

  it('exits 1 on any open critical violation', () => {
    expect(exitCodeFor({ violations: { by_severity: { critical: 1, high: 0, medium: 0, low: 0 } } })).toBe(1);
  });
});
