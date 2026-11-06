// EP-306-S1 — Claude Desktop config parser.
//
// The roadmap doc's original note ("~/.claude/claude_desktop_config.json")
// conflates this with Claude Code's project-level .claude/ directory, a
// different product. Claude Desktop's actual config file lives at an
// OS-specific path with no ~/.claude anywhere in it — see configPath() below.
import { readFileSync, existsSync } from 'fs';
import { homedir, platform } from 'os';
import { join } from 'path';
import { parseMcpServersConfig } from '../lib/parse-mcp-servers.js';

export const SOURCE = 'claude_desktop';

export function configPath() {
  const home = homedir();
  switch (platform()) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
    default: // linux and anything else
      return join(home, '.config', 'Claude', 'claude_desktop_config.json');
  }
}

export function parseConfig(raw, sourcePath) {
  return parseMcpServersConfig(raw, sourcePath, SOURCE);
}

// Missing config file is the common case (most machines running this don't
// have Claude Desktop installed at all) — that's an empty result, not an
// error. A malformed *existing* file still throws, via parseConfig, since
// that's a real signal worth surfacing rather than silently skipping.
export function scan() {
  const path = configPath();
  if (!existsSync(path)) return [];
  return parseConfig(readFileSync(path, 'utf8'), path);
}
