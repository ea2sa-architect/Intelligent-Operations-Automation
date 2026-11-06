import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('looksLikeMcp', () => {
  let looksLikeMcp;
  beforeEach(async () => {
    vi.resetModules();
    ({ looksLikeMcp } = await import('../src/parsers/docker.js'));
  });

  it('matches the official mcp/ Docker Hub namespace', () => {
    expect(looksLikeMcp('mcp/filesystem', 'node index.js')).toBe(true);
    expect(looksLikeMcp('mcp/puppeteer:latest', '')).toBe(true);
  });

  it('matches an image or command containing mcp-server / mcp_server', () => {
    expect(looksLikeMcp('ghcr.io/acme/mcp-server-crm', '')).toBe(true);
    expect(looksLikeMcp('some/image', 'python -m mcp_server_x')).toBe(true);
  });

  it('matches an npx-invoked official server package in the command', () => {
    expect(looksLikeMcp('node:20-alpine', 'npx -y @modelcontextprotocol/server-github')).toBe(true);
  });

  it('does not match an unrelated image/command', () => {
    expect(looksLikeMcp('postgres:16', 'postgres')).toBe(false);
    expect(looksLikeMcp('ioa-governance-platform-auth-service', 'node index.js')).toBe(false);
  });
});

// Mocks child_process's execFile with its real (cmd, args, options, callback)
// signature — see docker.js's comment on why this isn't util.promisify'd.
function mockExecFile(handler) {
  vi.doMock('child_process', () => ({
    execFile: (cmd, args, options, callback) => {
      const cb = typeof options === 'function' ? options : callback;
      handler(cmd, args, cb);
    },
  }));
}

describe('scan', () => {
  beforeEach(() => vi.resetModules());

  it('returns an empty array when docker is not installed / not running', async () => {
    mockExecFile((cmd, args, cb) => cb(new Error('command not found: docker')));
    const { scan } = await import('../src/parsers/docker.js');
    expect(await scan()).toEqual([]);
  });

  it('filters out containers that do not look like MCP servers', async () => {
    const psLine = JSON.stringify({ ID: 'c1', Names: 'my-postgres', Image: 'postgres:16', Command: '"postgres"' });
    mockExecFile((cmd, args, cb) => {
      if (args[0] === 'ps') return cb(null, psLine + '\n', '');
      cb(new Error('should not inspect a non-matching container'));
    });
    const { scan } = await import('../src/parsers/docker.js');
    expect(await scan()).toEqual([]);
  });

  it('reports a matching container with env hints (keys only, never values)', async () => {
    const psLine = JSON.stringify({
      ID: 'c2', Names: 'my-mcp-server', Image: 'mcp/filesystem',
      Command: '"npx -y @modelcontextprotocol/server-filesystem /data"',
    });
    mockExecFile((cmd, args, cb) => {
      if (args[0] === 'ps') return cb(null, psLine + '\n', '');
      if (args[0] === 'inspect') return cb(null, JSON.stringify(['API_TOKEN=super-secret-value', 'PORT=8080']) + '\n', '');
      cb(new Error('unexpected command'));
    });
    const { scan } = await import('../src/parsers/docker.js');
    const result = await scan();

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'my-mcp-server',
      command: 'npx -y @modelcontextprotocol/server-filesystem /data',
      args: [],
      url: null,
      env_hints: ['API_TOKEN', 'PORT'],
      source: 'docker',
      source_path: 'docker container: my-mcp-server (image: mcp/filesystem)',
    });
    expect(JSON.stringify(result)).not.toContain('super-secret-value');
  });

  it('still reports the container if docker inspect fails, just without env hints', async () => {
    const psLine = JSON.stringify({ ID: 'c3', Names: 'flaky-mcp', Image: 'mcp/puppeteer', Command: '"node server.js"' });
    mockExecFile((cmd, args, cb) => {
      if (args[0] === 'ps') return cb(null, psLine + '\n', '');
      if (args[0] === 'inspect') return cb(new Error('no such container'));
      cb(new Error('unexpected command'));
    });
    const { scan } = await import('../src/parsers/docker.js');
    const result = await scan();
    expect(result).toHaveLength(1);
    expect(result[0].env_hints).toEqual([]);
  });

  it('handles multiple ps lines, only reporting the matching ones', async () => {
    const lines = [
      JSON.stringify({ ID: 'c4', Names: 'redis', Image: 'redis:7', Command: '"redis-server"' }),
      JSON.stringify({ ID: 'c5', Names: 'mcp-github', Image: 'mcp/github', Command: '"node index.js"' }),
    ].join('\n');
    mockExecFile((cmd, args, cb) => {
      if (args[0] === 'ps') return cb(null, lines + '\n', '');
      if (args[0] === 'inspect') return cb(null, '[]\n', '');
      cb(new Error('unexpected command'));
    });
    const { scan } = await import('../src/parsers/docker.js');
    const result = await scan();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('mcp-github');
  });
});
