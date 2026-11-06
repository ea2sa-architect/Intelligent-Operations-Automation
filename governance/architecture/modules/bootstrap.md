---
type: module
name: bootstrap
purpose: "Config-driven infrastructure generator — writes each service's Dockerfile/package.json/index.js/db.js, k8s manifests, docker-compose.yml, and kong.yaml from bootstrap/platform.config.yaml"
status: active
depends_on: []
depended_by: []
entry_points: ["bootstrap/bootstrap-platform.js"]
components: 6
---

# bootstrap

## Purpose

Config-driven infrastructure generator — writes each service's Dockerfile/package.json/index.js/db.js, k8s manifests, docker-compose.yml, and kong.yaml from bootstrap/platform.config.yaml

## Architecture

See Key Files below.

## Key Files

- `bootstrap/generators/compose-generator.js` — Generates docker-compose.yml from platform.config.yaml
- `bootstrap/generators/k8s-generator.js` — Generates k8s/ manifests from platform.config.yaml
- `bootstrap/generators/kong-generator.js` — Generates kong/kong.yaml from platform.config.yaml
- `bootstrap/generators/service-generator.js` — Generates per-service Dockerfile/package.json/index.js/db.js from templates
- `bootstrap/tests/preserve-files.test.js` — Test suite (vitest/supertest)

## Dependencies

No outbound service dependencies detected.

