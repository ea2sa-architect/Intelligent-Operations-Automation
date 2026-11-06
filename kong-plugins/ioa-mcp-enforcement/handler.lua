-- ioa-mcp-enforcement — handler
--
-- One job: ask governance-service's POST /enforce whether this route's MCP
-- server may proceed, then block/warn/allow. Never touches routing/upstream
-- dispatch (see schema.lua's header comment) — Kong's own service.host
-- already points at the real MCP server; this plugin only runs in the
-- access phase before that proxy happens, plus a small header_filter step
-- to surface a warning back to the client.
--
-- kong.cache (mlcache, built into the Kong PDK) is used instead of a
-- manually-declared ngx.shared.DICT — no extra nginx.conf coordination
-- needed with whoever operates the shared Kong instance, and it's already
-- cluster/worker-aware. A short TTL (default 5s, config.cache_ttl_seconds)
-- keeps this plugin from calling /enforce — which re-runs full rule
-- evaluation — on every single proxied request; MCP traffic can be
-- high-volume and governance-service shouldn't be in the hot path at that
-- frequency.

local http   = require "resty.http"
local cjson  = require "cjson.safe"

local IoaMcpEnforcementHandler = {
  -- Low priority = runs LATE in the access phase (Kong executes access
  -- handlers in descending priority order). Deliberately lower than typical
  -- auth plugins (key-auth ~1003, jwt ~1005, acl ~950) so an unauthenticated
  -- request is rejected before this plugin ever calls out to
  -- governance-service. Verify against whatever auth plugin actually fronts
  -- each specific MCP route on the shared instance — see README.
  PRIORITY = 100,
  VERSION  = "1.0.0",
}

local function cache_key(asset_type, asset_id)
  return "ioa-enforce:" .. asset_type .. ":" .. asset_id
end

-- mlcache callback — only invoked on a cache miss. Returns (decision, err);
-- kong.cache propagates err as the second return of kong.cache:get().
local function call_enforce(conf)
  local httpc = http.new()
  httpc:set_timeout(conf.timeout_ms)

  local body, encode_err = cjson.encode({
    asset_type     = conf.asset_type,
    asset_id       = conf.asset_id,
    correlation_id = kong.request.get_header("X-Correlation-ID"),
  })
  if not body then
    return nil, "failed to encode /enforce request: " .. tostring(encode_err)
  end

  local res, err = httpc:request_uri(conf.governance_url .. "/enforce", {
    method  = "POST",
    body    = body,
    headers = {
      ["Content-Type"]          = "application/json",
      ["X-Internal-Service-Key"] = conf.internal_service_key,
    },
  })

  if not res then
    return nil, "request to governance-service failed: " .. tostring(err)
  end

  -- governance-service's /enforce returns 200 (allow/warn) or 403 (block) —
  -- both are expected, successful decisions, not HTTP errors to us. Any
  -- other status (500, connection refused surfaced as res=nil above, etc.)
  -- is treated as "no decision", triggering fail_mode below.
  if res.status ~= 200 and res.status ~= 403 then
    return nil, "unexpected governance-service status: " .. tostring(res.status)
  end

  local decoded, decode_err = cjson.decode(res.body)
  if not decoded then
    return nil, "invalid JSON from governance-service: " .. tostring(decode_err)
  end

  return decoded, nil
end

function IoaMcpEnforcementHandler:access(conf)
  local key = cache_key(conf.asset_type, conf.asset_id)

  local decision, err = kong.cache:get(key, { ttl = conf.cache_ttl_seconds }, call_enforce, conf)

  if err or not decision then
    kong.log.err("ioa-mcp-enforcement: ", err or "no decision returned from governance-service")
    if conf.fail_mode == "closed" then
      -- Deliberately NOT the fail-soft-to-allow pattern used elsewhere in
      -- this platform for read-only cross-service calls — this IS the
      -- enforcement decision itself. See enforcement-client.js
      -- (workflow-governance-service) for the same reasoning applied to the
      -- n8n gate. Distinguishable reason so an operator can tell this apart
      -- from an actual policy block.
      return kong.response.exit(403, {
        decision = "block",
        reason   = "governance-service unreachable",
      })
    end
    -- fail_mode = "open": let the request through unchecked. Explicit,
    -- visible opt-out — never the default.
    return
  end

  if decision.decision == "block" then
    return kong.response.exit(403, {
      decision   = "block",
      blocked_by = decision.blocked_by,
    })
  end

  if decision.decision == "warn" then
    local first = decision.warnings and decision.warnings[1]
    kong.ctx.shared.ioa_warning = first and first.policy_name or "policy warning"
  end

  -- decision.decision == "allow" (or unrecognized — fails open on the
  -- request itself since the block/deny paths above are the only ones that
  -- halt; an unrecognized decision string is a governance-service bug to
  -- fix there, not something this plugin should guess about).
end

function IoaMcpEnforcementHandler:header_filter(_conf)
  if kong.ctx.shared.ioa_warning then
    kong.response.set_header("X-IOA-Warning", kong.ctx.shared.ioa_warning)
  end
end

return IoaMcpEnforcementHandler
