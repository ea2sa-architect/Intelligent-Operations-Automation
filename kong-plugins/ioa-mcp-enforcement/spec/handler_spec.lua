-- busted spec for ioa-mcp-enforcement's handler.lua.
--
-- Run via `pongo run` (kong-pongo) — spins up a real, isolated Kong to
-- execute this. NOT run as part of this repo's own npm test/CI (no pongo in
-- this sandboxed dev environment) — see README.md's Testing section. This
-- file is the reviewable, documented contract for the handler's behavior;
-- treat a change to handler.lua that doesn't also update this spec (and get
-- it run for real) as unreviewed.

local handler_module = "kong.plugins.ioa-mcp-enforcement.handler"

local function base_conf(overrides)
  local conf = {
    governance_url        = "http://governance-service:3300",
    internal_service_key  = "test-key",
    asset_type             = "mcp_server",
    asset_id                = "srv-1",
    timeout_ms              = 2000,
    fail_mode                = "closed",
    cache_ttl_seconds        = 5,
  }
  for k, v in pairs(overrides or {}) do conf[k] = v end
  return conf
end

-- Forces kong.cache:get() to synchronously invoke the mlcache callback,
-- bypassing real caching — the point of these specs is the decision logic,
-- not mlcache itself (that's Kong's own, already-tested machinery).
local function stub_kong(overrides)
  local exited, warning_header

  _G.kong = {
    cache = {
      get = function(_self, _key, _opts, cb, ...)
        return cb(...)
      end,
    },
    ctx = { shared = {} },
    log = { err = function() end },
    request = { get_header = function() return nil end },
    response = {
      exit = function(status, body)
        exited = { status = status, body = body }
      end,
      set_header = function(name, value)
        if name == "X-IOA-Warning" then warning_header = value end
      end,
    },
  }
  for k, v in pairs(overrides or {}) do _G.kong[k] = v end

  return {
    get_exit = function() return exited end,
    get_warning_header = function() return warning_header end,
  }
end

describe("ioa-mcp-enforcement handler", function()
  local Handler
  local http_stub

  before_each(function()
    package.loaded[handler_module] = nil
    package.loaded["resty.http"] = nil

    http_stub = { response = nil, error = nil }
    package.preload["resty.http"] = function()
      return {
        new = function()
          return {
            set_timeout = function() end,
            request_uri = function()
              if http_stub.error then return nil, http_stub.error end
              return http_stub.response
            end,
          }
        end,
      }
    end

    Handler = require(handler_module)
  end)

  it("allows through with no side effects when governance-service returns allow", function()
    http_stub.response = { status = 200, body = '{"decision":"allow"}' }
    local probe = stub_kong()

    Handler:access(base_conf())

    assert.is_nil(probe.get_exit())
  end)

  it("sets X-IOA-Warning via header_filter and does not block on warn", function()
    http_stub.response = {
      status = 200,
      body = '{"decision":"warn","warnings":[{"policy_id":"p1","policy_name":"My Policy"}]}',
    }
    local probe = stub_kong()

    Handler:access(base_conf())
    assert.is_nil(probe.get_exit())

    Handler:header_filter(base_conf())
    assert.are.equal("My Policy", probe.get_warning_header())
  end)

  it("blocks with 403 and forwards blocked_by when governance-service returns block", function()
    http_stub.response = {
      status = 403,
      body = '{"decision":"block","blocked_by":{"policy_id":"p1","violation_id":"v1"}}',
    }
    local probe = stub_kong()

    Handler:access(base_conf())

    local exited = probe.get_exit()
    assert.are.equal(403, exited.status)
    assert.are.equal("block", exited.body.decision)
    assert.are.equal("v1", exited.body.blocked_by.violation_id)
  end)

  it("fails CLOSED (403) when governance-service is unreachable and fail_mode is closed", function()
    http_stub.error = "connection refused"
    local probe = stub_kong()

    Handler:access(base_conf({ fail_mode = "closed" }))

    local exited = probe.get_exit()
    assert.are.equal(403, exited.status)
    assert.are.equal("governance-service unreachable", exited.body.reason)
  end)

  it("fails OPEN (no exit) when governance-service is unreachable and fail_mode is open", function()
    http_stub.error = "connection refused"
    local probe = stub_kong()

    Handler:access(base_conf({ fail_mode = "open" }))

    assert.is_nil(probe.get_exit())
  end)

  it("treats an unexpected HTTP status from governance-service as no decision (subject to fail_mode)", function()
    http_stub.response = { status = 500, body = "internal error" }
    local probe = stub_kong()

    Handler:access(base_conf({ fail_mode = "closed" }))

    local exited = probe.get_exit()
    assert.are.equal(403, exited.status)
    assert.are.equal("governance-service unreachable", exited.body.reason)
  end)
end)
