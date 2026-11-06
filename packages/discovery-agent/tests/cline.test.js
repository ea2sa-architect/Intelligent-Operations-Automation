import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('parseConfig', () => {
  it('tags results with the vscode_cline source', async () => {
    const { parseConfig } = await import('../src/parsers/cline.js');
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    const [result] = parseConfig(raw, '/fake/path.json');
    expect(result.source).toBe('vscode_cline');
  });
});

describe('configPath', () => {
  const ORIGINAL_PLATFORM = process.platform;
  const ORIGINAL_APPDATA = process.env.APPDATA;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM });
    process.env.APPDATA = ORIGINAL_APPDATA;
    vi.resetModules();
  });

  it('resolves under VS Code globalStorage for the saoudrizwan.claude-dev extension on macOS', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { configPath } = await import('../src/parsers/cline.js');
    expect(configPath()).toMatch(
      /Library\/Application Support\/Code\/User\/globalStorage\/saoudrizwan\.claude-dev\/settings\/cline_mcp_settings\.json$/
    );
  });

  it('resolves under .config/Code on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { configPath } = await import('../src/parsers/cline.js');
    expect(configPath()).toMatch(
      /\.config\/Code\/User\/globalStorage\/saoudrizwan\.claude-dev\/settings\/cline_mcp_settings\.json$/
    );
  });

  it('resolves under APPDATA on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const { configPath } = await import('../src/parsers/cline.js');
    expect(configPath()).toContain('saoudrizwan.claude-dev');
    expect(configPath()).toContain('cline_mcp_settings.json');
  });
});

describe('scan', () => {
  beforeEach(() => vi.resetModules());

  it('returns an empty array when the config file does not exist', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));
    const { scan } = await import('../src/parsers/cline.js');
    expect(scan()).toEqual([]);
  });

  it('parses the file when it exists', async () => {
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    vi.doMock('fs', () => ({ existsSync: () => true, readFileSync: () => raw }));
    const { scan } = await import('../src/parsers/cline.js');
    const result = scan();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('s1');
  });
});
