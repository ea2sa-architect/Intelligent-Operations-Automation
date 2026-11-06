import { describe, it, expect, vi, afterEach } from 'vitest';
import { runExecutionTier } from '../src/pipeline/execute.js';

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

describe('runExecutionTier', () => {
  it('reports not_eligible when no execution profile has ever been requested', async () => {
    mockByUrl([['/execution-profile', { ok: false, status: 404, json: () => Promise.resolve({ error: 'none' }) }]]);
    const result = await runExecutionTier({ baseUrl: 'https://ioa.example.com', token: 'jwt', workflowId: 'wf-1' });
    expect(result).toEqual({ status: 'not_eligible', reason: 'no execution profile has been requested for this workflow', scenarios_run: 0, results: [] });
  });

  it('reports not_approved (never a silent skip) when a profile exists but is pending/rejected', async () => {
    mockByUrl([['/execution-profile', { ok: true, json: () => Promise.resolve({ id: 'profile-1', status: 'pending_review' }) }]]);
    const result = await runExecutionTier({ baseUrl: 'https://ioa.example.com', token: 'jwt', workflowId: 'wf-1' });
    expect(result.status).toBe('not_approved');
    expect(result.reason).toMatch(/pending_review/);
    expect(result.scenarios_run).toBe(0);
  });

  it('runs every scenario against the resolved webhook_url and reports real HTTP outcomes', async () => {
    mockByUrl([
      ['/execution-profile', { ok: true, json: () => Promise.resolve({
        id: 'profile-1', status: 'approved', webhook_url: 'https://n8n.example.com/webhook/abc',
        scenarios_json: [{ name: 'happy path', payload_json: { foo: 'bar' } }, { name: 'edge case', payload_json: {} }],
      }) }],
      ['n8n.example.com/webhook/abc', { ok: true, status: 200, json: () => Promise.resolve({ ok: true }) }],
    ]);

    const result = await runExecutionTier({ baseUrl: 'https://ioa.example.com', token: 'jwt', workflowId: 'wf-1' });

    expect(result.status).toBe('tested');
    expect(result.scenarios_run).toBe(2);
    expect(result.results.map(r => r.scenario)).toEqual(['happy path', 'edge case']);
    expect(result.results[0].http_status).toBe(200);
    expect(typeof result.results[0].latency_ms).toBe('number');
    expect(result.results[0].correlation_id).toMatch(/^ioa-qa-/);

    // real payloads were actually sent, not faked
    const webhookCall = global.fetch.mock.calls.find(([url]) => url.includes('webhook/abc'));
    expect(JSON.parse(webhookCall[1].body)).toEqual({ foo: 'bar' });
  });

  it('captures a scenario-level error instead of throwing (one bad scenario should not abort the rest)', async () => {
    let call = 0;
    global.fetch = vi.fn((url) => {
      call++;
      if (url.includes('execution-profile')) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({
          id: 'profile-1', status: 'approved', webhook_url: 'https://n8n.example.com/webhook/abc',
          scenarios_json: [{ name: 'will fail', payload_json: {} }],
        }) });
      }
      return Promise.reject(new Error('network unreachable'));
    });

    const result = await runExecutionTier({ baseUrl: 'https://ioa.example.com', token: 'jwt', workflowId: 'wf-1' });

    expect(result.status).toBe('tested');
    expect(result.results[0].error).toBe('network unreachable');
  });
});
