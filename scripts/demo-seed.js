// IOA demo seed — sets up a coherent, presenter-ready dataset that
// demonstrates Discover → Assess → Approve → Enforce in one story arc,
// rather than the older db/seeds/001_demo*.sql files (May 2026, AI-model/
// telemetry only — predate MCP registry, waivers, and approval chains
// entirely, and 001_demo_data.sql references governance.policies.logic_json,
// which no longer exists as of migration 024).
//
// Run: node scripts/demo-seed.js
// Requires the stack up (docker compose up) and reachable through Kong at
// KONG_PROXY_URL (default http://localhost:8000), plus AUTH_ADMIN_USERNAME/
// PASSWORD matching whatever's actually seeded in auth.users right now.
//
// NOT idempotent — every server/policy/chain is created with a demo- name
// prefix specifically so a stale run is easy to find and clean up by hand,
// but re-running this script will create duplicates, not update in place.
// See DEMO_SCRIPT.md's "Resetting between run-throughs" section.

const BASE = process.env.KONG_PROXY_URL || 'http://localhost:8000';
const USERNAME = process.env.AUTH_ADMIN_USERNAME || 'admin';
const PASSWORD = process.env.AUTH_ADMIN_PASSWORD;

if (!PASSWORD) {
  console.error('Set AUTH_ADMIN_PASSWORD (matching the live auth.users admin hash) before running this.');
  process.exit(1);
}

// AUTH-305 double-submit CSRF — same pattern as web/src/lib/api.js: the
// server sets a non-httpOnly ioa_csrf cookie at login specifically so a
// caller can read it back and echo it as a header on every mutating call.
let cookieJar = {};
const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

function updateCookieJar(res) {
  for (const raw of res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie')].filter(Boolean)) {
    const [pair] = raw.split(';');
    const eq = pair.indexOf('=');
    cookieJar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
}

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const cookieHeader = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
  if (cookieHeader) headers.Cookie = cookieHeader;
  if (MUTATING.includes(method) && cookieJar.ioa_csrf) headers['X-CSRF-Token'] = cookieJar.ioa_csrf;

  const res = await fetch(`${BASE}/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  updateCookieJar(res);

  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function login() {
  await call('POST', '/auth/login', { username: USERNAME, password: PASSWORD });
  console.log(`Logged in as ${USERNAME}`);
}

async function main() {
  await login();
  const created = { servers: {}, policies: {}, chain: null, chainRequest: null, waiver: null };

  // ── 1. MCP servers across risk tiers — the Discover/Assess story ───────
  console.log('\nCreating MCP servers…');

  created.servers.finance = await call('POST', '/mcp-governance/servers', {
    name: 'demo-finance-reporting-mcp', transport: 'remote', endpoint: 'https://finance.example.com/mcp',
    risk_tier: 'low', trusted_publisher: true, publisher: 'Internal Platform Team',
    business_owner: 'Finance Ops', technical_owner: 'Platform Engineering',
    approved_use_case: 'Quarterly report generation from the internal data warehouse',
  });
  await call('PATCH', `/mcp-governance/servers/${created.servers.finance.id}/status`, { status: 'approved' });
  console.log('  finance-reporting-mcp — approved (low risk, calm baseline)');

  created.servers.customerData = await call('POST', '/mcp-governance/servers', {
    name: 'demo-customer-data-connector-mcp', transport: 'remote', endpoint: 'https://data-connector.example.com/mcp',
    risk_tier: 'high', trusted_publisher: false, publisher: 'Third-Party Vendor Co',
    business_owner: 'Customer Success', technical_owner: 'Integrations Team',
    approved_use_case: 'Pulls customer profile data for a support-agent workflow',
  });
  console.log('  customer-data-connector-mcp — pending_review (high risk, untrusted publisher)');

  created.servers.payment = await call('POST', '/mcp-governance/servers', {
    name: 'demo-payment-processor-mcp', transport: 'remote', endpoint: 'https://payments.example.com/mcp',
    risk_tier: 'critical', trusted_publisher: true, publisher: 'Payments Platform Team',
    business_owner: 'Finance', technical_owner: 'Payments Engineering',
    approved_use_case: 'Initiates vendor payment runs from an approved workflow',
  });
  console.log('  payment-processor-mcp — pending_review (critical risk — will drive the Approve chain demo)');

  created.servers.legacy = await call('POST', '/mcp-governance/servers', {
    name: 'demo-legacy-reporting-mcp', transport: 'local', endpoint: 'http://localhost:9999/mcp',
    risk_tier: 'moderate', trusted_publisher: true,
  });
  await call('PATCH', `/mcp-governance/servers/${created.servers.legacy.id}/status`, { status: 'approved' });
  await call('PATCH', `/mcp-governance/servers/${created.servers.legacy.id}/status`, { status: 'retired', reason: 'Superseded by finance-reporting-mcp' });
  console.log('  legacy-reporting-mcp — retired (history/contrast)');

  // ── 2. Policies in each enforcement mode — the Enforce story ────────────
  console.log('\nBinding policies in observe/warn/enforce modes…');

  const untrustedPublisherPolicy = (await call('GET', '/governance/policies')).find(p => p.name === 'MCP Untrusted Publisher Block');
  if (untrustedPublisherPolicy) {
    await call('POST', `/governance/policies/${untrustedPublisherPolicy.id}/bindings`, {
      entity_type: 'mcp_server', entity_id: created.servers.customerData.id,
    });
    await call('PATCH', `/governance/policies/${untrustedPublisherPolicy.id}/enforcement-mode`, { enforcement_mode: 'warn' });
    await call('POST', '/governance/violations/evaluate', { server_id: created.servers.customerData.id });
    console.log('  MCP Untrusted Publisher Block -> WARN, bound to customer-data-connector-mcp');
  } else {
    console.log('  (skipped: starter policy "MCP Untrusted Publisher Block" not found — run db migrations)');
  }

  created.policies.observeDemo = await call('POST', '/governance/policies', {
    name: 'demo-observe-mode-policy', description: 'Demo: records decisions without blocking anything.', status: 'active',
  });
  await call('POST', `/governance/policies/${created.policies.observeDemo.id}/rules`, {
    rule_type: 'mcp_server_registration', severity: 'low', config_json: { require_approved_status: 'false' },
  });
  await call('POST', `/governance/policies/${created.policies.observeDemo.id}/bindings`, {
    entity_type: 'mcp_server', entity_id: created.servers.finance.id,
  });
  console.log('  demo-observe-mode-policy -> OBSERVE (default), bound to finance-reporting-mcp');

  created.policies.enforceDemo = await call('POST', '/governance/policies', {
    name: 'demo-enforce-mode-policy', description: 'Demo: actively blocks — flip live during the presentation.', status: 'active',
  });
  await call('POST', `/governance/policies/${created.policies.enforceDemo.id}/rules`, {
    rule_type: 'mcp_untrusted_publisher', severity: 'critical', config_json: {},
  });
  await call('POST', `/governance/policies/${created.policies.enforceDemo.id}/bindings`, {
    entity_type: 'mcp_server', entity_id: created.servers.customerData.id,
  });
  console.log('  demo-enforce-mode-policy -> OBSERVE for now (flip to Enforce live on stage)');

  // ── 3. A waiver in flight — the Approve/exception story ─────────────────
  console.log('\nRequesting a waiver on the untrusted-publisher violation…');
  const violations = await call('GET', `/governance/violations?entity_type=mcp_server&entity_id=${created.servers.customerData.id}`);
  const openViolation = violations.find(v => v.status === 'open' || v.status === 'reopened');
  if (openViolation) {
    const expires = new Date(Date.now() + 14 * 86_400_000).toISOString();
    created.waiver = await call('POST', `/governance/violations/${openViolation.id}/waivers`, {
      justification: 'Vendor security review in progress; temporary exception while SOC 2 report is obtained.',
      expires_at: expires,
    });
    console.log('  Waiver requested — pending in Administration -> Waivers');
  } else {
    console.log('  (skipped: no open violation found to waive yet)');
  }

  // ── 4. Approval chain, started but not decided — the marquee Approve moment
  console.log('\nSetting up the critical-tier approval chain…');
  created.chain = await call('POST', '/governance/approval-chains', {
    name: 'demo-critical-mcp-chain', risk_tier: 'critical', execution_mode: 'sequential',
    stages: [{ order: 1, approver_role: 'admin', quorum: 1 }],
  });
  const approveAttempt = await call('PATCH', `/mcp-governance/servers/${created.servers.payment.id}/status`, { status: 'approved' });
  created.chainRequest = approveAttempt.request ?? null;
  console.log(created.chainRequest
    ? '  payment-processor-mcp approval chain started — pending decision (demo this live under Administration -> Approval Chains)'
    : '  (unexpected: server approved immediately — check the chain was created before the approve call)');

  // ── Summary ───────────────────────────────────────────────────────────
  console.log('\n============================================================');
  console.log('Demo data ready. Cheat sheet:');
  console.log('============================================================');
  console.log(`Finance server (calm, Observe mode):      ${created.servers.finance.id}`);
  console.log(`Customer-data server (Warn + waiver):      ${created.servers.customerData.id}`);
  console.log(`Payment server (mid approval-chain):        ${created.servers.payment.id}`);
  console.log(`Legacy server (retired, for contrast):      ${created.servers.legacy.id}`);
  console.log(`Enforce-mode demo policy (flip live):       ${created.policies.enforceDemo.id}`);
  if (created.chainRequest) console.log(`Approval chain request (decide live):       ${created.chainRequest.id}`);
  if (created.waiver) console.log(`Pending waiver (decide live):                ${created.waiver.id}`);
  console.log('\nSee DEMO_SCRIPT.md for the full walkthrough.');
}

main().catch(err => { console.error('\nDemo seed failed:', err.message); process.exit(1); });
