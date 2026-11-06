---
type: module
name: db
purpose: "Idempotent DB migration runner (db/migrate.js) plus demo-data seeding, applied across every service's schema in the shared Postgres/TimescaleDB instance"
status: active
depends_on: []
depended_by: []
entry_points: ["db/migrate.js"]
components: 26
---

# db

## Purpose

Idempotent DB migration runner (db/migrate.js) plus demo-data seeding, applied across every service's schema in the shared Postgres/TimescaleDB instance

## Architecture

See Key Files below.

## Key Files

- `db/migrate.js` — Idempotent DB migration runner (tracks state in public.migrations)
- `db/seed-demo.js` — Seeds demo data directly into Postgres for local development
- `scripts/demo-seed.js` — Seeds demo data via HTTP calls through the running services

## Dependencies

No outbound service dependencies detected.

