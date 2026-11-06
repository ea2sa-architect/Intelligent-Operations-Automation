-- ioa-mcp-enforcement — schema
--
-- Topology A (static per-server routes): each registered MCP server that
-- reaches 'approved' gets its own Kong service + route (provisioned by
-- services/mcp-governance-service/src/lib/kong-provisioner.js), so asset_id
-- is a fixed, known value per plugin instance — no path/header parsing at
-- request time. Routing itself stays entirely Kong's job (service.host
-- pointing at the real MCP server endpoint); this plugin only ever decides
-- allow/warn/block, never touches the upstream target.

local typedefs = require "kong.db.schema.typedefs"

return {
  name = "ioa-mcp-enforcement",
  fields = {
    { consumer = typedefs.no_consumer },
    { protocols = typedefs.protocols_http },
    { config = {
        type = "record",
        fields = {
          { governance_url = {
              type = "string",
              required = true,
              -- e.g. http://governance-service:3300 — the internal service
              -- hostname, not the Kong-fronted /api/governance path.
          } },
          { internal_service_key = {
              type = "string",
              required = true,
              referenceable = true, -- supports {vault://...} in Kong OSS 3.x+; see README
          } },
          { asset_type = {
              type = "string",
              default = "mcp_server",
          } },
          { asset_id = {
              type = "string",
              required = true,
              -- The governance.policy_bindings entity_id this route
              -- represents — one Kong service/route per approved MCP server.
          } },
          { timeout_ms = {
              type = "number",
              default = 2000,
              between = { 100, 30000 },
          } },
          { fail_mode = {
              type = "string",
              default = "closed",
              one_of = { "closed", "open" },
              -- closed: governance-service unreachable => 403 (deny-by-
              -- default, matches enforcement-client.js's n8n gate). open is
              -- an explicit, visible opt-out for a route where availability
              -- must win — never the default.
          } },
          { cache_ttl_seconds = {
              type = "number",
              default = 5,
              between = { 0, 300 },
              -- 0 disables caching — every request calls /enforce fresh.
          } },
        },
    } },
  },
}
