import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import mcpGovernanceClient from '../src/lib/mcp-governance-client.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('resolveServerReference', () => {
  it('returns registered:false for an empty reference without calling fetch', async () => {
    const result = await mcpGovernanceClient.resolveServerReference('');
    expect(result).toEqual({ registered: false });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns registered:false on a 404', async () => {
    global.fetch.mockResolvedValueOnce({ status: 404, ok: false });
    const result = await mcpGovernanceClient.resolveServerReference('unknown');
    expect(result).toEqual({ registered: false });
  });

  it('returns the resolved server on success', async () => {
    global.fetch.mockResolvedValueOnce({ status: 200, ok: true, json: async () => ({ registered: true, id: 'srv-1', name: 'crm-mcp' }) });
    const result = await mcpGovernanceClient.resolveServerReference('crm-mcp');
    expect(result).toEqual({ registered: true, id: 'srv-1', name: 'crm-mcp' });
    // AUTH-201 (extended) — carries no browser session, authenticates with
    // the shared internal service key instead
    expect(global.fetch.mock.calls[0][1].headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  // Epic 2, Feature 2.2 — ambiguous matches (409) surface candidates rather
  // than collapsing into a plain "not registered"
  it('surfaces ambiguous candidates on a 409', async () => {
    global.fetch.mockResolvedValueOnce({
      status: 409, ok: false,
      json: async () => ({ ambiguous: true, candidates: [{ id: 'srv-1', name: 'crm-mcp' }, { id: 'srv-2', name: 'crm-mcp-2' }] }),
    });
    const result = await mcpGovernanceClient.resolveServerReference('crm');
    expect(result.registered).toBe(false);
    expect(result.ambiguous).toBe(true);
    expect(result.candidates).toHaveLength(2);
  });

  it('fails soft to registered:false when the service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await mcpGovernanceClient.resolveServerReference('crm-mcp');
    expect(result).toEqual({ registered: false });
  });
});

describe('reportDiscovery', () => {
  it('does nothing when name is missing, without calling fetch', async () => {
    await mcpGovernanceClient.reportDiscovery({ name: null, sourcePath: 'n8n workflow: x' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('posts to /servers/discovery-import with url set to the reference and source tagged n8n_workflow', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ created: 1 }) });
    await mcpGovernanceClient.reportDiscovery({ name: 'crm-mcp', sourcePath: 'n8n workflow: Lead Sync (node: HTTP Request)' });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/servers\/discovery-import$/);
    expect(opts.headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
    expect(JSON.parse(opts.body)).toEqual({
      discovered: [{
        name: 'crm-mcp', url: 'crm-mcp', source: 'n8n_workflow',
        source_path: 'n8n workflow: Lead Sync (node: HTTP Request)', env_hints: [],
      }],
    });
  });

  it('fails soft (does not throw) when the service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(mcpGovernanceClient.reportDiscovery({ name: 'crm-mcp', sourcePath: 'x' })).resolves.toBeUndefined();
  });
});

describe('fetchServerDetail', () => {
  it('returns null for a missing serverId without calling fetch', async () => {
    const result = await mcpGovernanceClient.fetchServerDetail(null);
    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns null on a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false });
    const result = await mcpGovernanceClient.fetchServerDetail('srv-1');
    expect(result).toBeNull();
  });

  it('returns the server detail on success', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'srv-1', tools: [] }) });
    const result = await mcpGovernanceClient.fetchServerDetail('srv-1');
    expect(result).toEqual({ id: 'srv-1', tools: [] });
    expect(global.fetch.mock.calls[0][1].headers['X-Internal-Service-Key']).toBe('test-internal-service-key');
  });

  it('fails soft to null when the service is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    const result = await mcpGovernanceClient.fetchServerDetail('srv-1');
    expect(result).toBeNull();
  });
});
