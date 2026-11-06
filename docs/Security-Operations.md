# Security Operations — IOA Governance Platform

Reference procedures for rotating credentials and responding to security events.
All secrets live in `.env` (gitignored). Rotate with `scripts/rotate-service-key.sh`
or follow the procedures below for manual rotation.

---

## INTERNAL_SERVICE_KEY rotation (zero-downtime)

The `INTERNAL_SERVICE_KEY` is shared by all services for server-to-server calls.
`require-auth.js` accepts both the current key and the new key during a 60-second
overlap window, so services can be updated without stopping requests.

```bash
# Automated (recommended):
./scripts/rotate-service-key.sh

# Dry run (shows what would happen, makes no changes):
./scripts/rotate-service-key.sh --dry-run
```

**Manual steps if the script is unavailable:**
1. Generate: `openssl rand -hex 32`
2. Update `INTERNAL_SERVICE_KEY` in `.env`
3. For each running container: `docker exec <name> sh -c 'export INTERNAL_SERVICE_KEY=<new>'`
4. Wait 60 seconds (overlap window for in-flight requests)
5. Schedule a clean restart at next maintenance: `docker compose up --build -d`

---

## POSTGRES_PASSWORD rotation

Requires a brief maintenance window (Postgres does not hot-reload passwords).

1. Stop all services (not the DB): `docker compose stop $(docker compose config --services | grep -v db)`
2. Connect to the DB: `docker exec -it ioa-governance-platform-db-1 psql -U ioa -d ioa_governance`
3. Change the password: `ALTER USER ioa WITH PASSWORD 'new-password';`
4. Exit psql, update `.env`: `POSTGRES_PASSWORD=new-password`
5. Restart all services: `docker compose up -d`

---

## N8N_WEBHOOK_SECRET rotation

Requires coordinating with the n8n workflow that sends the `X-IOA-Signature` header.

1. Generate new secret: `openssl rand -hex 32`
2. Update the n8n workflow's HTTP Request node (Header Auth value) with `sha256=<hmac(body, new-secret)>`
3. Update `.env`: `N8N_WEBHOOK_SECRET=new-secret`
4. Restart workflow-governance-service: `docker compose restart workflow-governance-service`

There is no overlap window for this secret — n8n and the service must be updated
atomically. Schedule during a low-traffic period or during a maintenance window.

---

## AUTH_JWT_PRIVATE_KEY / AUTH_JWT_PUBLIC_KEY rotation (RS256)

Rotating the JWT signing key invalidates all active sessions (users are logged out).
Schedule during a maintenance window and notify users in advance.

1. Generate a new RS256 key pair:
   ```bash
   openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:4096 -out private.pem
   openssl rsa -in private.pem -pubout -out public.pem
   ```
2. Base64-encode both:
   ```bash
   base64 -w0 private.pem   # → AUTH_JWT_PRIVATE_KEY value
   base64 -w0 public.pem    # → AUTH_JWT_PUBLIC_KEY value
   ```
3. Update `.env` with both values
4. Restart all services: `docker compose up --build -d`
   - auth-service issues new tokens with the new key immediately on restart
   - All other services accept tokens signed with the new public key
   - Existing sessions (old tokens) become invalid — users must log in again

---

## Kong rate-limit policy

Kong rate limiting is configured via `bootstrap/platform.config.yaml` → `kongDefaults.rateLimit`
and per-service `rateLimit:` overrides (auth-service: 10 req/min). After changing
these values, regenerate and sync:

```bash
node bootstrap/bootstrap-platform.js bootstrap --kong-only
npm run kong:sync
```

---

## Emergency: suspected credential compromise

1. Immediately rotate `INTERNAL_SERVICE_KEY` (zero-downtime: `./scripts/rotate-service-key.sh`)
2. Rotate `N8N_WEBHOOK_SECRET` (brief n8n disruption)
3. If auth credentials compromised: rotate `AUTH_JWT_PRIVATE_KEY` (users are logged out)
4. If DB password compromised: rotate `POSTGRES_PASSWORD` (maintenance window)
5. Review `audit.audit_events` for suspicious activity:
   ```sql
   SELECT * FROM audit.audit_events
   WHERE event_type IN ('auth.login', 'auth.failure')
   ORDER BY created_at DESC LIMIT 100;
   ```
6. File an incident in Linear project INGEST with the timeline and affected credentials
