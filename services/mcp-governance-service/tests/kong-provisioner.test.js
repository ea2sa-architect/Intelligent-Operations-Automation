import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import kongProvisioner from '../src/lib/kong-provisioner.js';

const ORIGINAL_ENV = { ...process.env };
const SERVER = { id: 'srv-1', endpoint: 'https://mcp.example.com' };

// KONG_ADMIN_URL/GOVERNANCE_SERVICE_URL are read into module-level consts at
// import time, so setting them here wouldn't take effect — asserting against
// the module's actual defaults instead (same reasoning as
// governance-client.js's own tests).
beforeEach(() => {
  global.fetch = vi.fn();
  process.env.INTERNAL_SERVICE_KEY = 'test-internal-service-key';
});
afterEach(() => { vi.restoreAllMocks(); process.env = { ...ORIGINAL_ENV }; });

describe('provisionServer', () => {
  it('upserts the service, route, and plugin in order, creating a new plugin when none exists', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'kong-svc-1' }) })   // service upsert
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'kong-route-1' }) }) // route upsert
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })            // plugin lookup — none found
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'kong-plugin-1' }) }); // plugin create

    await kongProvisioner.provisionServer(SERVER);
    expect(global.fetch).toHaveBeenCalledTimes(4);

    const [serviceUrl, serviceOpts] = global.fetch.mock.calls[0];
    expect(serviceUrl).toBe('http://localhost:8001/services/mcp-server-srv-1');
    expect(serviceOpts.method).toBe('PUT');
    expect(JSON.parse(serviceOpts.body)).toEqual({ url: 'https://mcp.example.com', enabled: true });

    const [routeUrl, routeOpts] = global.fetch.mock.calls[1];
    expect(routeUrl).toBe('http://localhost:8001/services/mcp-server-srv-1/routes/mcp-server-srv-1-route');
    expect(routeOpts.method).toBe('PUT');
    expect(JSON.parse(routeOpts.body)).toEqual({ paths: ['/mcp/srv-1'], strip_path: true });

    const [lookupUrl] = global.fetch.mock.calls[2];
    expect(lookupUrl).toBe('http://localhost:8001/routes/mcp-server-srv-1-route/plugins?name=ioa-mcp-enforcement');

    const [createUrl, createOpts] = global.fetch.mock.calls[3];
    expect(createUrl).toBe('http://localhost:8001/routes/mcp-server-srv-1-route/plugins');
    expect(createOpts.method).toBe('POST');
    expect(JSON.parse(createOpts.body)).toEqual({
      name: 'ioa-mcp-enforcement',
      config: {
        governance_url: 'http://governance-service:3300',
        internal_service_key: 'test-internal-service-key',
        asset_type: 'mcp_server',
        asset_id: 'srv-1',
        fail_mode: 'closed',
      },
    });
  });

  it('PATCHes the existing plugin instance instead of creating a duplicate', async () => {
    global.fetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'kong-svc-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'kong-route-1' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'existing-plugin-id' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'existing-plugin-id' }) });

    await kongProvisioner.provisionServer(SERVER);

    const [updateUrl, updateOpts] = global.fetch.mock.calls[3];
    expect(updateUrl).toBe('http://localhost:8001/plugins/existing-plugin-id');
    expect(updateOpts.method).toBe('PATCH');
    expect(JSON.parse(updateOpts.body).config.asset_id).toBe('srv-1');
  });

  it('does not throw when Kong is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(kongProvisioner.provisionServer(SERVER)).resolves.toBeUndefined();
  });

  it('does not throw when Kong returns a non-ok response', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'internal error' });
    await expect(kongProvisioner.provisionServer(SERVER)).resolves.toBeUndefined();
  });
});

describe('deprovisionServer', () => {
  it('disables the Kong service by name', async () => {
    global.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'kong-svc-1', enabled: false }) });

    await kongProvisioner.deprovisionServer('srv-1');

    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe('http://localhost:8001/services/mcp-server-srv-1');
    expect(opts.method).toBe('PATCH');
    expect(JSON.parse(opts.body)).toEqual({ enabled: false });
  });

  it('treats a 404 (never provisioned) as a no-op, not an error', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 404, text: async () => 'Not found' });
    await expect(kongProvisioner.deprovisionServer('srv-never-approved')).resolves.toBeUndefined();
  });

  it('does not throw when Kong is unreachable', async () => {
    global.fetch.mockRejectedValueOnce(new Error('connection refused'));
    await expect(kongProvisioner.deprovisionServer('srv-1')).resolves.toBeUndefined();
  });
});
