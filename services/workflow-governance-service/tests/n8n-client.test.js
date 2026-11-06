import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import n8nClient from '../src/lib/n8n-client.js';

const ORIGINAL_ENV = { ...process.env };
beforeEach(() => { global.fetch = vi.fn(); });
afterEach(() => { process.env = { ...ORIGINAL_ENV }; vi.restoreAllMocks(); });

describe('buildExecutionUrl', () => {
  it('strips the /api/v1 management-API suffix and builds the execution deep link', () => {
    process.env.N8N_BASE_URL = 'https://ea2sa.app.n8n.cloud/api/v1';
    expect(n8nClient.buildExecutionUrl('wf-1', 'exec-4821'))
      .toBe('https://ea2sa.app.n8n.cloud/workflow/wf-1/executions/exec-4821');
  });

  it('handles a base URL with no trailing /api/v1 unchanged', () => {
    process.env.N8N_BASE_URL = 'https://n8n.example.com';
    expect(n8nClient.buildExecutionUrl('wf-1', 'exec-4821'))
      .toBe('https://n8n.example.com/workflow/wf-1/executions/exec-4821');
  });

  it('returns null when workflowId is missing', () => {
    process.env.N8N_BASE_URL = 'https://ea2sa.app.n8n.cloud/api/v1';
    expect(n8nClient.buildExecutionUrl(null, 'exec-4821')).toBeNull();
  });

  it('returns null when executionId is missing', () => {
    process.env.N8N_BASE_URL = 'https://ea2sa.app.n8n.cloud/api/v1';
    expect(n8nClient.buildExecutionUrl('wf-1', null)).toBeNull();
  });

  it('prefers an explicit config.base_url over the env var', () => {
    process.env.N8N_BASE_URL = 'https://ea2sa.app.n8n.cloud/api/v1';
    expect(n8nClient.buildExecutionUrl('wf-1', 'exec-1', { base_url: 'https://self-hosted.example.com/api/v1' }))
      .toBe('https://self-hosted.example.com/workflow/wf-1/executions/exec-1')
  })
});

// A stored platform_connections row (set via the Integrations admin UI)
// must actually govern which n8n instance these calls hit — previously
// listWorkflows/getWorkflow silently ignored it and always used the env
// vars (see adapters/n8n.js's removed "Phase 2 will thread config
// credentials through properly" comment).
describe('config threading (base_url/api_key override the env vars)', () => {
  it('listWorkflows uses config.base_url/api_key when supplied', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    await n8nClient.listWorkflows({ base_url: 'https://self-hosted.example.com/api/v1', api_key: 'conn-key' });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toContain('https://self-hosted.example.com/api/v1');
    expect(opts.headers['X-N8N-API-KEY']).toBe('conn-key');
  });

  it('getWorkflow uses config.base_url when supplied', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'wf-1' }) });
    await n8nClient.getWorkflow('wf-1', { base_url: 'https://self-hosted.example.com/api/v1', api_key: 'conn-key' });
    expect(global.fetch.mock.calls[0][0]).toBe('https://self-hosted.example.com/api/v1/workflows/wf-1');
  });
});
