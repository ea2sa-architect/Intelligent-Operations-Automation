import { describe, it, expect, vi, afterEach } from 'vitest';
import { runVerifyRelease, exitCodeForDecision } from '../src/pipeline/run-verify-release.js';

const ORIGINAL_FETCH = global.fetch;
afterEach(() => { global.fetch = ORIGINAL_FETCH; });

function mockByUrl(map) {
  global.fetch = vi.fn((url, opts) => {
    for (const [pattern, response] of map) {
      if (typeof pattern === 'string' ? url.includes(pattern) : pattern.test(url)) return Promise.resolve(response);
    }
    throw new Error(`No mock for ${opts?.method ?? 'GET'} ${url}`);
  });
}

describe('runVerifyRelease', () => {
  it('runs assess, marks execution not_eligible, and posts the evidence bundle', async () => {
    mockByUrl([
      [/\/workflows\/wf-1$/, { ok: true, json: () => Promise.resolve({ id: 'wf-1', name: 'My Workflow', mcp_references: [] }) }],
      ['/violations/evaluate', { ok: true, json: () => Promise.resolve({}) }],
      ['/policy-bindings', { ok: true, json: () => Promise.resolve({ policies: [] }) }],
      ['/violations?', { ok: true, json: () => Promise.resolve([]) }],
      ['/anomaly/baselines/wf-1', { ok: false, status: 404, json: () => Promise.resolve({ error: 'none' }) }],
      ['/execution-profile', { ok: false, status: 404, json: () => Promise.resolve({ error: 'none' }) }],
      ['/release-decisions', { ok: true, json: () => Promise.resolve({ id: 'rd-1', decision: 'certified' }) }],
    ]);

    const { evidenceBundle, decision } = await runVerifyRelease({
      baseUrl: 'https://ioa.example.com', token: 'jwt', target: 'wf-1', releaseRef: 'abc123', decidedBy: 'system:ioa-cli',
    });

    expect(evidenceBundle.execution).toEqual({
      status: 'not_eligible', reason: 'no execution profile has been requested for this workflow', scenarios_run: 0, results: [],
    });
    expect(decision).toEqual({ id: 'rd-1', decision: 'certified' });

    const postCall = global.fetch.mock.calls.find(([url]) => url.includes('/release-decisions'));
    const body = JSON.parse(postCall[1].body);
    expect(body.entity_id).toBe('wf-1');
    expect(body.release_ref).toBe('abc123');
    expect(body.decided_by).toBe('system:ioa-cli');
    expect(body.evidence_bundle.execution.status).toBe('not_eligible');
  });
});

describe('exitCodeForDecision', () => {
  it('exits 0 for certified and certified_with_waivers', () => {
    expect(exitCodeForDecision({ decision: 'certified' })).toBe(0);
    expect(exitCodeForDecision({ decision: 'certified_with_waivers' })).toBe(0);
  });

  it('exits 1 for rejected', () => {
    expect(exitCodeForDecision({ decision: 'rejected' })).toBe(1);
  });
});
