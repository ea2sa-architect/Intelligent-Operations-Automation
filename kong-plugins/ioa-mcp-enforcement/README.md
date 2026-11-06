# ioa-mcp-enforcement

A small Kong plugin: for a route dedicated to one approved MCP server, calls
governance-service's `POST /enforce` and allows, warns, or blocks (403)
accordingly. It does not resolve or rewrite the upstream target — routing to
the real MCP server is Kong's own `service.host`, set once when the route is
provisioned (see "Provisioning" below). The plugin only ever answers one
question: *is this server's bound policy currently in a state that says stop
this request?*

## Why a plugin instead of a pre-function

A `pre-function`/`post-function` snippet would work too, but a named plugin
gets a typed `schema.lua` (Kong validates `asset_id`, `fail_mode`, etc. at
config time instead of failing at request time), a stable identity in
`kong/backups/*.yaml` deck snapshots, and its own test suite — worth it given
this sits in the request path for every MCP call, on a shared instance with
other teams' traffic on it too.

## Config

| field | required | default | |
|---|---|---|---|
| `governance_url` | yes | — | e.g. `http://governance-service:3300` (internal hostname, not the `/api/governance` Kong-fronted path) |
| `internal_service_key` | yes | — | shared secret for `X-Internal-Service-Key`; `referenceable = true`, so pass it as `{vault://...}` rather than plaintext once a vault backend is configured (Kong OSS 3.x+ supports this natively) |
| `asset_type` | no | `mcp_server` | |
| `asset_id` | yes | — | the `governance.policy_bindings.entity_id` this route represents — one value per server, since topology A gives each approved server its own route |
| `timeout_ms` | no | `2000` | budget for the call to governance-service |
| `fail_mode` | no | `closed` | `closed`: governance-service unreachable → 403. `open`: let the request through. Never default to `open` — see rationale in `handler.lua` |
| `cache_ttl_seconds` | no | `5` | via `kong.cache` (mlcache) — avoids calling `/enforce` (which re-runs full rule evaluation) on every proxied request |

## Provisioning (topology A — static per-server routes)

Each MCP server gets its own Kong service + route + plugin binding the
moment it's **approved** (not at registration — an unreviewed server has no
business receiving proxied traffic, same deny-by-default posture as the rest
of this platform). This is automated by
`services/mcp-governance-service/src/lib/kong-provisioner.js`, called from
`PATCH /servers/:id/status`:

- `status → approved`: create/update the Kong service (`host` = the
  server's real `endpoint`) + route + this plugin's config
  (`asset_id = server.id`).
- `status → rejected` / `retired`: disable the Kong **service** (`enabled:
  false` — routes have no enabled flag in Kong 3.x, verified against
  `/schemas/routes`; a disabled service makes Kong return 503 for any route
  pointing at it), rather than deleting anything. Matches this platform's
  existing append-only-audit posture elsewhere; nothing about a server's
  Kong presence should quietly disappear. Re-approving later re-enables it.

This is a **live Kong Admin API integration**, not a declarative-file
regeneration — the shared instance is DB-backed (confirmed via its existing
`kong/backups/*.yaml` deck snapshots and working entity CRUD), so creating
one route per approved server is cheap and doesn't require a `kong reload`
or touching `bootstrap/generators/kong-generator.js` (that generator only
covers this project's own 8 fixed microservices, not the dynamic MCP
registry).

## Deploying the plugin code itself

Unlike config (routes/plugin instances, provisioned dynamically above), the
Lua code has to be on the Kong container's filesystem, with
`KONG_PLUGINS=bundled,ioa-mcp-enforcement` set, followed by `kong reload`.
This is a one-time (or per-release) step, coordinated with whoever operates
the shared instance:

- **Fast iteration** (dev/staging Kong you control): bind-mount this
  directory and set `KONG_LUA_PACKAGE_PATH=/path/to/kong-plugins/?.lua;;`
  alongside `KONG_PLUGINS`.
- **The real shared instance**: bake this directory into a custom Kong image
  layer (`COPY kong-plugins/ioa-mcp-enforcement /usr/local/share/lua/5.1/kong/plugins/ioa-mcp-enforcement`),
  same `KONG_PLUGINS` env var, roll the image.

No shared `ngx.shared.DICT` declaration is needed (deliberately avoided —
see `handler.lua`'s header comment) — one less thing to coordinate on the
nginx.conf side of a container this repo doesn't own.

## Testing

- `spec/handler_spec.lua` — `busted` specs, run via `kong-pongo` (`pongo run`
  from this directory). **Not executed as part of this repo's own CI/test
  commands** — pongo spins up a real, isolated Kong + Postgres to run
  plugin specs, which isn't available in this sandboxed dev environment.
  Treat the spec file as the documented, reviewable contract for the
  handler's behavior; run it for real before trusting a change to
  `handler.lua` in production.
- `kong-provisioner.js`'s own test suite (`tests/kong-provisioner.test.js`)
  covers the Node-side Admin API calls with the same mocked-fetch pattern
  used throughout this codebase, and *is* part of the normal
  `npm test`/CI path.

## Rollout

1. Provision the route for one server whose bound policy is still in
   `observe` — confirm `governance.enforcement_events` gets rows from real
   MCP traffic, confirm no request is blocked or measurably delayed.
2. Flip that policy to `warn` — confirm `X-IOA-Warning` reaches the actual
   MCP client without breaking it (verify a real client tolerates an
   unexpected header before assuming this).
3. Flip to `enforce`, bake, watch `enforcement_events`/`violations` for
   false positives before touching a second server.
4. Repeat per server as each is approved — this is now the default path via
   `kong-provisioner.js`, not a one-off.
