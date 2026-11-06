import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('parseConfig', () => {
  it('tags results with the cursor source', async () => {
    const { parseConfig } = await import('../src/parsers/cursor.js');
    const raw = JSON.stringify({ mcpServers: { s1: { command: 'node' } } });
    const [result] = parseConfig(raw, '/fake/mcp.json');
    expect(result.source).toBe('cursor');
  });
});

describe('globalConfigPath', () => {
  it('resolves to ~/.cursor/mcp.json', async () => {
    const { globalConfigPath } = await import('../src/parsers/cursor.js');
    expect(globalConfigPath()).toMatch(/\.cursor\/mcp\.json$/);
  });
});

describe('projectConfigPath', () => {
  it('resolves .cursor/mcp.json relative to the given working directory', async () => {
    const { projectConfigPath } = await import('../src/parsers/cursor.js');
    expect(projectConfigPath('/repo/project')).toBe('/repo/project/.cursor/mcp.json');
  });
});

describe('scan', () => {
  beforeEach(() => vi.resetModules());

  it('returns an empty array when neither config file exists', async () => {
    vi.doMock('fs', () => ({ existsSync: () => false, readFileSync: vi.fn() }));
    const { scan } = await import('../src/parsers/cursor.js');
    expect(scan()).toEqual([]);
  });

  it('combines results from both global and project config when both exist', async () => {
    const raw = JSON.stringify({ mcpServers: { s: { command: 'node' } } });
    vi.doMock('fs', () => ({ existsSync: () => true, readFileSync: () => raw }));
    const { scan } = await import('../src/parsers/cursor.js');
    expect(scan()).toHaveLength(2);
  });
});
