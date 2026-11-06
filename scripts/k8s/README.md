# IOA on Kubernetes (kind, on Phoenix)

Everything under `k8s/` is **generated** from the `kubernetes:` block and `services:` in
`bootstrap/platform.config.yaml` — change the config, run `npm run bootstrap`, never edit `k8s/` by hand.

```
client ─► Route 53 ─► nginx (gilbert: TLS + SPA) ─/api/─► phoenix:18080 ─► kind NodePort 30080
                                                                              │
   ns ioa-governance:  Kong (DB-less, x2) ─► 8 services + api-docs ─► TimescaleDB (PVC) · Redis
                       migrate Job · nightly pg_dump CronJob · NetworkPolicies · PodDisruptionBudgets
```

## Commands

| Task | Command |
|---|---|
| Deploy / update (idempotent) | `scripts/k8s/up.sh` |
| Deploy + restore a dump | `scripts/k8s/up.sh --restore ~/ioa-kind/dumps/<file>.dump` |
| Take a dump of the live compose DB | `scripts/k8s/dump-live.sh` |
| Re-create secrets only | `scripts/k8s/secrets.sh` |
| Tear down (data survives in `~/ioa-kind/data`) | `scripts/k8s/down.sh` |

Always use `--context kind-ioa` (the scripts do); `up.sh` restores your previous default context after creating the cluster.

## Release a new version
1. Bump `kubernetes.imageTag` in `platform.config.yaml`, `npm run bootstrap`, commit.
2. `scripts/k8s/up.sh` — rebuilds/loads images, re-runs the migrate Job, rolls Deployments with `maxUnavailable: 0`.

## Hardening in place
Restricted Pod Security on the namespace; non-root, read-only root FS, no privilege escalation, all caps dropped,
seccomp RuntimeDefault, no service-account token; resource requests+limits everywhere; startup/readiness/liveness probes;
default-deny ingress NetworkPolicy with explicit allows (gateway→apps, apps→apps, apps/jobs→db, apps→redis, only
mcp-governance→Kong admin); PodDisruptionBudgets for multi-replica workloads; pinned image tags; secrets out of git.

## Known limits (be upfront with clients)
- **Single node.** kind runs one node, so replicas/PDBs/anti-affinity are configured but can't demonstrate real HA or node-failure recovery. The same manifests target a multi-node cluster.
- **Kong is DB-less.** Routes/plugins come from the declarative config. mcp-governance's live Kong Admin API provisioning (per-MCP-server routes on approval) can't write in DB-less mode; it fails soft (logged), exactly as when Kong is unreachable.
- **Egress is not restricted** (services call n8n cloud). Ingress is.
- **TLS terminates at nginx on gilbert**; gilbert→phoenix:18080 is plain HTTP on the LAN, same as the previous phoenix:8000 hop.
- **Rate limiting is per Kong replica** (`policy: local`: 100/min default, 10/min on auth, each replica counts separately). It is keyed on the real client IP: Kong trusts `X-Forwarded-For` only from the trusted proxy peers (gilbert), and the NodePort uses `externalTrafficPolicy: Local` so the peer address is preserved. The trusted proxy CIDRs are kept out of git: put them in `~/ioa-kind/trusted_proxies` (or `$TRUSTED_PROXIES`) and run `scripts/k8s/local-config.sh` (up.sh does this); update that file if the front proxy IP changes.
- **Backups** live on a PVC on the same node (`ioa-backups`); copy them off-box for real DR.
- **kind data** lives in `~/ioa-kind/data` on Phoenix; the cluster is not a substitute for managed infrastructure.

## Demo login
`scripts/k8s/secrets.sh` seeds a `demo-admin` account (role `admin`) through auth-service's `AUTH_ADMIN2_*` hook. Its password is generated once and kept in `~/ioa-kind/demo_admin_password` (mode 600). The repo `.env` admin password is only the original seed value and may be stale. Rotate or delete `demo-admin` after the demo.

## Pre-cutover UI test (canary)
`scripts/k8s/canary-nginx.sh enable|disable|status` — run on gilbert. A secret link sets a cookie so *that browser's* `/api/` goes to the cluster while everyone else still hits live; the SPA is the unchanged production build. Use a private window (login cookies are path `/` on the same host and would replace your live session). n8n cloud callbacks carry no cookie, so they still land on live during the canary.

## Cutover (ioa.ea2sa.com → this cluster) and rollback
On gilbert, in `/etc/nginx/sites-available/ioa.ea2sa.com.conf` change the `/api/` upstream
`proxy_pass http://phoenix:8000;` → `http://phoenix:18080;`, `nginx -t`, reload.
Rollback = restore the timestamped `.bak` copy and reload.
