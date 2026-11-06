import { describe, it, expect } from 'vitest';
import { parseMcpServersConfig } from '../src/lib/parse-mcp-servers.js';

// Shared by claude-desktop.js and cline.js — both use the mcpServers shape.
describe('parseMcpServersConfig', () => {
  it('extracts name, command, args, and env hints (not values), tagged with the given source', () => {
    const raw = JSON.stringify({
      mcpServers: {
        'my-server': {
          command: 'npx',
          args: ['-y', '@some/mcp-server'],
          env: { API_KEY: 'sk-super-secret-value', OTHER_VAR: 'also-secret' },
        },
      },
    });

    const result = parseMcpServersConfig(raw, '/fake/path.json', 'some_source');
    expect(result).toEqual([{
      name: 'my-server',
      command: 'npx',
      args: ['-y', '@some/mcp-server'],
      url: null,
      env_hints: ['API_KEY', 'OTHER_VAR'],
      source: 'some_source',
      source_path: '/fake/path.json',
    }]);
    // never leaks the actual secret value anywhere in the result
    expect(JSON.stringify(result)).not.toContain('sk-super-secret-value');
  });

  it('returns an empty array when mcpServers is absent', () => {
    expect(parseMcpServersConfig(JSON.stringify({}), '/fake/path.json', 's')).toEqual([]);
  });

  it('returns an empty array when mcpServers is not an object', () => {
    expect(parseMcpServersConfig(JSON.stringify({ mcpServers: 'nonsense' }), '/fake/path.json', 's')).toEqual([]);
  });

  it('throws a descriptive error on malformed JSON', () => {
    expect(() => parseMcpServersConfig('{not json', '/fake/path.json', 's')).toThrow(/fake\/path\.json/);
  });

  it('handles a server entry with no env block', () => {
    const raw = JSON.stringify({ mcpServers: { bare: { command: 'node', args: ['server.js'] } } });
    const [result] = parseMcpServersConfig(raw, '/fake/path.json', 's');
    expect(result.env_hints).toEqual([]);
  });

  it('handles a server entry with no args', () => {
    const raw = JSON.stringify({ mcpServers: { bare: { command: 'node' } } });
    const [result] = parseMcpServersConfig(raw, '/fake/path.json', 's');
    expect(result.args).toEqual([]);
  });
});
