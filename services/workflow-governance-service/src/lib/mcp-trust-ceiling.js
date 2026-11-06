// Derives ATI trust-ceiling conditions from a workflow's referenced MCP
// servers (Epic 5, Feature 5.2). Pure and I/O-free by design — HTTP fetching
// lives in mcp-governance-client.js, so this is trivially unit-testable and
// keeps the "what counts as a ceiling condition" logic in one place.
//
// A workflow can reference multiple MCP servers; each contributes zero or
// more ceilings. trust-index.js takes the lowest cap across all of them —
// this module only decides which conditions apply and why, not how they combine.

function hasUnreviewedDrift(tools = []) {
  return tools.some(t => t.last_drift_detected_at && t.approval_status === 'pending');
}

function hasUnapprovedProductionWrite(server, tools = []) {
  return server.hosting_environment === 'production'
    && tools.some(t => t.behavior === 'write' && t.approval_status !== 'allowed');
}

function hasNoOwner(server) {
  return !server.technical_owner && !server.business_owner;
}

function hasTokenPassthrough(authorizations = []) {
  return authorizations.some(a => a.token_passthrough_detected);
}

// Epic 5, Feature 5.3 — a confirmed hardcoded-credential match in the
// server's own configuration data (endpoint, integrity_info, a resource's
// uri_template, etc.) is the same class of critical finding as token
// passthrough — bypass the graduated risk score entirely.
function hasConfirmedCredentialExposure(server) {
  return (server.credential_exposure ?? []).length > 0;
}

// Epic 6, Features 6.3/6.4 — evidence that was once validated but has since
// expired (a credential-rotation or revocation test that's gone stale) is
// the concrete case the original planning document called out: "mission-
// critical tool, no revocation/recovery evidence → ATI ≤ 60". Deliberately
// does NOT penalize a server with zero evidence at all — this is a brand-new
// capability with no seeded baseline, so "never assessed" isn't punished the
// same way "assessed, then let it lapse" is.
function hasExpiredAssuranceEvidence(server) {
  return (server.assurance_evidence ?? []).some(e => e.status === 'expired');
}

// resolvedRefs: [{ node_name, server_reference, registered, mcp_server_id, mcp_server_name }]
// serverDetailsById: Map<mcp_server_id, { hosting_environment, technical_owner, business_owner, tools, authorizations, name }>
function deriveMcpCeilings(resolvedRefs = [], serverDetailsById = new Map()) {
  const ceilings = [];

  for (const ref of resolvedRefs) {
    if (!ref.registered) {
      ceilings.push({ cap: 40, reason: `Unregistered MCP server referenced by node "${ref.node_name}"` });
      continue;
    }

    const server = serverDetailsById.get(ref.mcp_server_id);
    if (!server) continue; // detail unreachable this run — can't evaluate further conditions

    if (hasUnreviewedDrift(server.tools)) {
      ceilings.push({ cap: 50, reason: `MCP server "${server.name}" has an unreviewed tool-definition change` });
    }
    if (hasUnapprovedProductionWrite(server, server.tools)) {
      ceilings.push({ cap: 35, reason: `MCP server "${server.name}" has unapproved write-capable tools in production` });
    }
    if (hasNoOwner(server)) {
      ceilings.push({ cap: 84, reason: `MCP server "${server.name}" has no assigned owner` });
    }
    if (hasTokenPassthrough(server.authorizations)) {
      ceilings.push({ cap: 15, reason: `MCP server "${server.name}" has token passthrough detected (critical)` });
    }
    if (hasConfirmedCredentialExposure(server)) {
      ceilings.push({ cap: 15, reason: `MCP server "${server.name}" has a confirmed credential exposure in its configuration (critical)` });
    }
    if (hasExpiredAssuranceEvidence(server)) {
      ceilings.push({ cap: 60, reason: `MCP server "${server.name}" has expired assurance evidence (revocation/recovery/rotation test gone stale)` });
    }
  }

  return ceilings;
}

export default { deriveMcpCeilings };
