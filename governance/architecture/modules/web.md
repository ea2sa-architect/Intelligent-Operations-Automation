---
type: module
name: web
purpose: "React 18 SPA — full CRUD governance UI (Vite, Tailwind v4, TanStack Query, React Router), talks to every service through Kong's /api/* proxy"
status: active
depends_on: ["governance-service", "ai-inference-service", "audit-service", "escalation-service", "telemetry-service", "workflow-governance-service", "mcp-governance-service", "auth-service", "api-docs"]
depended_by: []
entry_points: ["web/src/main.jsx"]
components: 220
---

# web

## Purpose

React 18 SPA — full CRUD governance UI (Vite, Tailwind v4, TanStack Query, React Router), talks to every service through Kong's /api/* proxy

## Architecture

See Key Files below.

## Key Files

- `web/src/App.jsx` — React Router route table; /admin/* nested under AdminLayout
- `web/src/components/AdminLayout.jsx` — Admin section header + horizontal sub-nav + Outlet
- `web/src/components/AuthGuard.jsx` — Route guard: redirects unauthenticated users, gates on permissions
- `web/src/components/ChangePasswordModal.jsx` — Modal for self-service password change
- `web/src/components/Layout.jsx` — Sidebar nav incl. collapsible Administration section
- `web/src/components/ui/Badge.jsx` — Reusable UI primitive
- `web/src/components/ui/Button.jsx` — Reusable UI primitive
- `web/src/components/ui/Card.jsx` — Reusable UI primitive
- `web/src/components/ui/ConfirmDialog.jsx` — Reusable UI primitive
- `web/src/components/ui/InfoTip.jsx` — Reusable UI primitive
- `web/src/components/ui/Input.jsx` — Reusable UI primitive
- `web/src/components/ui/Modal.jsx` — Reusable UI primitive
- `web/src/components/ui/PasswordInput.jsx` — Reusable UI primitive
- `web/src/components/ui/Table.jsx` — Reusable UI primitive
- `web/src/hooks/useConfirm.jsx` — Promise-based confirm-dialog hook
- `web/src/hooks/useTags.js` — Shared TanStack Query hook for the tag registry, deduplicates fetches
- `web/src/lib/api.js` — All SPA API clients (governance, inference, audit, escalation, telemetry, tags, workflowGovernance, auth, budgets, + others — see CLAUDE.md for the full list)
- `web/src/pages/admin/BudgetAdmin.jsx` — Usage budget CRUD (E7-S1.4); mirrors TagAdmin.jsx's inline add/edit/archive pattern
- `web/src/lib/helpContent.js` — InfoTip copy keyed by page/field
- `web/src/lib/utils.js` — Shared SPA utility functions
- `web/src/pages/AiInference.jsx` — Top-level SPA page
- `web/src/pages/AnomalyDetection.jsx` — Top-level SPA page
- `web/src/pages/Assurance.jsx` — Top-level SPA page
- `web/src/pages/Audit.jsx` — Top-level SPA page
- `web/src/pages/Dashboard.jsx` — Top-level SPA page
- `web/src/pages/Escalation.jsx` — Top-level SPA page
- _(+17 more files)_

## Dependencies

Depends on: `governance-service`, `ai-inference-service`, `audit-service`, `escalation-service`, `telemetry-service`, `workflow-governance-service`, `mcp-governance-service`, `auth-service`, `api-docs`

