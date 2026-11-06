import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Content-parsing behavior (env hints, malformed JSON, etc.) is covered once,
// against the shared helper, in parse-mcp-servers.test.js. This file only
// covers what's specific to Claude Desktop: where its config lives and that
// parseConfig/scan wire up to the shared helper with the right source tag.

describe('parseConfig', () => {
  it('tags results with the claude_desktop source', async () => {
    const { parseConfig } = await import('../src/parsers/claude-desktop.js');
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    const [result] = parseConfig(raw, '/fake/path.json');
    expect(result.source).toBe('claude_desktop');
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

  it('resolves the macOS path under Library/Application Support', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { configPath } = await import('../src/parsers/claude-desktop.js');
    expect(configPath()).toMatch(/Library\/Application Support\/Claude\/claude_desktop_config\.json$/);
  });

  it('resolves the Linux path under .config', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const { configPath } = await import('../src/parsers/claude-desktop.js');
    expect(configPath()).toMatch(/\.config\/Claude\/claude_desktop_config\.json$/);
  });

  it('resolves the Windows path under APPDATA', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const { configPath } = await import('../src/parsers/claude-desktop.js');
    expect(configPath()).toContain('Claude');
    expect(configPath()).toContain('claude_desktop_config.json');
  });

  it('does not point at ~/.claude — that is Claude Code, a different product', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const { configPath } = await import('../src/parsers/claude-desktop.js');
    expect(configPath()).not.toMatch(/^\/[^/]*\/[^/]*\/\.claude\//);
  });
});

describe('scan', () => {
  beforeEach(() => vi.resetModules());

  it('returns an empty array when the config file does not exist', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));
    const { scan } = await import('../src/parsers/claude-desktop.js');
    expect(scan()).toEqual([]);
  });

  it('parses the file when it exists', async () => {
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    vi.doMock('fs', () => ({ existsSync: () => true, readFileSync: () => raw }));
    const { scan } = await import('../src/parsers/claude-desktop.js');
    const result = scan();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('s1');
  });
});
