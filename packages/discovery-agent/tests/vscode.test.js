import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('parseConfig', () => {
  let parseConfig;
  beforeEach(async () => {
    vi.resetModules();
    ({ parseConfig } = await import('../src/parsers/vscode.js'));
  });

  it('extracts a stdio server (command/args/env), tagged with the vscode source', () => {
    const raw = JSON.stringify({
      servers: {
        filesystem: { type: 'stdio', command: 'npx', args: ['-y', '@mcp/fs'], env: { TOKEN: 'secret-value' } },
      },
    });
    const [result] = parseConfig(raw, '/fake/mcp.json');
    expect(result).toEqual({
      name: 'filesystem', command: 'npx', args: ['-y', '@mcp/fs'], url: null,
      env_hints: ['TOKEN'], source: 'vscode', source_path: '/fake/mcp.json',
    });
    expect(JSON.stringify(result)).not.toContain('secret-value');
  });

  it('extracts a url-based http/sse server with no command', () => {
    const raw = JSON.stringify({
      servers: { remote: { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: 'Bearer secret-token' } } },
    });
    const [result] = parseConfig(raw, '/fake/mcp.json');
    expect(result.command).toBeNull();
    expect(result.url).toBe('https://example.com/mcp');
    // headers aren't env, but should never leak into the output either
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('reads the "servers" key, not "mcpServers"', () => {
    const raw = JSON.stringify({ mcpServers: { wrong: { command: 'node' } } });
    expect(parseConfig(raw, '/fake/mcp.json')).toEqual([]);
  });

  it('returns an empty array when servers is absent', () => {
    expect(parseConfig(JSON.stringify({}), '/fake/mcp.json')).toEqual([]);
  });

  it('throws a descriptive error on malformed JSON', () => {
    expect(() => parseConfig('{not json', '/fake/mcp.json')).toThrow(/fake\/mcp\.json/);
  });
});

describe('userConfigPath', () => {
  const ORIGINAL_PLATFORM = process.platform;
  const ORIGINAL_APPDATA = process.env.APPDATA;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM });
    process.env.APPDATA = ORIGINAL_APPDATA;
    vi.resetModules();
  });

  it('resolves under Code/User on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { userConfigPath } = await import('../src/parsers/vscode.js');
    expect(userConfigPath()).toMatch(/Library\/Application Support\/Code\/User\/mcp\.json$/);
  });

  it('resolves under .config/Code/User on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { userConfigPath } = await import('../src/parsers/vscode.js');
    expect(userConfigPath()).toMatch(/\.config\/Code\/User\/mcp\.json$/);
  });

  it('does not use .vscode/settings.json — that key is not used for MCP config at all', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { userConfigPath } = await import('../src/parsers/vscode.js');
    expect(userConfigPath()).not.toContain('settings.json');
  });
});

describe('workspaceConfigPath', () => {
  it('resolves .vscode/mcp.json relative to the given (or current) working directory', async () => {
    const { workspaceConfigPath } = await import('../src/parsers/vscode.js');
    expect(workspaceConfigPath('/repo/project')).toBe('/repo/project/.vscode/mcp.json');
  });
});

describe('scan', () => {
  beforeEach(() => vi.resetModules());

  it('returns an empty array when neither config file exists', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));
    const { scan } = await import('../src/parsers/vscode.js');
    expect(scan()).toEqual([]);
  });

  it('combines results from both the user-profile and workspace config when both exist', async () => {
    const raw = JSON.stringify({ servers: { s: { command: 'node' } } });
    vi.doMock('fs', () => ({ existsSync: () => true, readFileSync: () => raw }));
    const { scan } = await import('../src/parsers/vscode.js');
    expect(scan()).toHaveLength(2);
  });
});
