---
type: module
name: discovery-agent
purpose: "Scans the local dev environment for MCP client configs (Claude Desktop, Cline, Cursor, Docker, VS Code, Windsurf) and reports discovered MCP servers to mcp-governance-service"
status: active
depends_on: ["mcp-governance-service"]
depended_by: []
entry_points: ["packages/discovery-agent/bin/discovery-agent.js"]
components: 39
---

# discovery-agent

## Purpose

Scans the local dev environment for MCP client configs (Claude Desktop, Cline, Cursor, Docker, VS Code, Windsurf) and reports discovered MCP servers to mcp-governance-service

## Architecture

See Key Files below.

## Key Files

- `packages/discovery-agent/bin/discovery-agent.js` — discovery-agent CLI entry point
- `packages/discovery-agent/src/api-client.js` — HTTP client for the IOA governance API
- `packages/discovery-agent/src/duration.js` — Duration parsing/formatting utility
- `packages/discovery-agent/src/lib/parse-mcp-servers.js` — Normalizes parsed MCP server entries across client formats
- `packages/discovery-agent/src/parsers/claude-desktop.js` — Parses this client's MCP server config format
- `packages/discovery-agent/src/parsers/cline.js` — Parses this client's MCP server config format
- `packages/discovery-agent/src/parsers/cursor.js` — Parses this client's MCP server config format
- `packages/discovery-agent/src/parsers/docker.js` — Parses this client's MCP server config format
- `packages/discovery-agent/src/parsers/vscode.js` — Parses this client's MCP server config format
- `packages/discovery-agent/src/parsers/windsurf.js` — Parses this client's MCP server config format
- `packages/discovery-agent/src/scan.js` — Orchestrates the local MCP-config discovery scan
- `packages/discovery-agent/tests/docker.test.js` — Test suite (vitest/supertest)
- `packages/discovery-agent/tests/scan.test.js` — Test suite (vitest/supertest)

## Dependencies

Depends on: `mcp-governance-service`

