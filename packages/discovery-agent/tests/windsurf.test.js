import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('parseConfig', () => {
  it('tags results with the windsurf source', async () => {
    const { parseConfig } = await import('../src/parsers/windsurf.js');
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    const [result] = parseConfig(raw, '/fake/mcp_config.json');
    expect(result.source).toBe('windsurf');
  });
});

describe('configPath', () => {
  it('resolves to ~/.codeium/windsurf/mcp_config.json', async () => {
    const { configPath } = await import('../src/parsers/windsurf.js');
    expect(configPath()).toMatch(/\.codeium\/windsurf\/mcp_config\.json$/);
  });
});

describe('scan', () => {
  beforeEach(() => vi.resetModules());

  it('returns an empty array when the config file does not exist', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));
    const { scan } = await import('../src/parsers/windsurf.js');
    expect(scan()).toEqual([]);
  });

  it('parses the file when it exists', async () => {
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    vi.doMock('fs', () => ({ existsSync: () => true, readFileSync: () => raw }));
    const { scan } = await import('../src/parsers/windsurf.js');
    const result = scan();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('s1');
  });
});
