#!/usr/bin/env node
/**
 * IOA Governance Platform — Demo Seed Script
 *
 * Populates the database with a rich, realistic dataset suitable for
 * comprehensive product demonstrations. Safe to re-run (all inserts use
 * ON CONFLICT DO NOTHING or explicit existence checks).
 *
 * Run: node db/seed-demo.js
 *      (or via Docker: see docs/Jenkins-SPA-Deploy.md)
 */
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://ioa:ioa@localhost:5439/ioa_governance',
});

async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

function log(msg) { console.log(`  ✔  ${msg}`); }
function section(msg) { console.log(`\n→ ${msg}`); }

// ─── Helpers ────────────────────────────────────────────────────────────────

async function lookupPolicy(name) {
  const r = await query('SELECT id FROM governance.policies WHERE name = $1', [name]);
  return r.rows[0]?.id ?? null;
}

async function lookupRule(policyName, conditionType) {
  const r = await query(`
    SELECT pr.id FROM governance.policy_rules pr
    JOIN governance.policies p ON p.id = pr.policy_id
    WHERE p.name = $1 AND pr.condition_json->>'type' = $2
    LIMIT 1
  `, [policyName, conditionType]);
  return r.rows[0]?.id ?? null;
}

async function lookupServer(name) {
  const r = await query('SELECT id FROM mcp_governance.mcp_servers WHERE name = $1', [name]);
  return r.rows[0]?.id ?? null;
}

async function pickWorkflowIds(n) {
  const r = await query(
    'SELECT id FROM workflow_governance.workflows ORDER BY discovered_at DESC LIMIT $1', [n]);
  return r.rows.map(row => row.id);
}

// ─── 1. Additional MCP Servers ───────────────────────────────────────────────

async function seedMcpServers() {
  section('MCP Servers');
  const servers = [
    {
      name: 'financial-ledger-access-mcp',
      version: '2.1.0', publisher: 'FinOps Internal', transport: 'local',
      endpoint: 'http://financial-ledger.internal:4001',
      protocol_version: '2024-11-05', authentication_method: 'oauth2',
      hosting_environment: 'production', deployment_location: 'us-east-1',
      technical_owner: 'finops-team@company.com',
      business_owner: 'CFO Office',
      approved_use_case: 'Automated journal entry creation and ledger reconciliation for month-end close',
      data_classification: 'confidential', risk_tier: 'critical', status: 'approved',
      trusted_publisher: true,
      downstream_systems: ['sap-erp', 'reporting-warehouse', 'compliance-vault'],
      expiration_date: new Date(Date.now() + 180 * 86400000),
    },
    {
      name: 'hr-employee-data-mcp',
      version: '1.4.2', publisher: 'HR Platform Team', transport: 'remote',
      endpoint: 'http://hr-platform.internal:4002',
      protocol_version: '2024-11-05', authentication_method: 'oauth2',
      hosting_environment: 'production', deployment_location: 'us-east-1',
      technical_owner: 'hr-platform@company.com',
      business_owner: 'VP Human Resources',
      approved_use_case: 'Employee record retrieval for AI-assisted HR workflows and compensation benchmarking',
      data_classification: 'restricted', risk_tier: 'critical', status: 'pending_review',
      trusted_publisher: false,
      downstream_systems: ['workday', 'payroll-system', 'benefits-platform'],
      expiration_date: null,
    },
    {
      name: 'code-execution-sandbox-mcp',
      version: '3.0.1', publisher: 'DevOps Platform', transport: 'local',
      endpoint: 'http://sandbox.internal:4003',
      protocol_version: '2024-11-05', authentication_method: 'api_key',
      hosting_environment: 'test', deployment_location: 'us-west-2',
      technical_owner: 'devops@company.com',
      business_owner: 'CTO Office',
      approved_use_case: 'Isolated code execution for AI-generated analytics scripts — no production data access',
      data_classification: 'internal', risk_tier: 'critical', status: 'approved',
      trusted_publisher: true,
      downstream_systems: ['sandbox-db', 'artifact-store'],
      expiration_date: new Date(Date.now() + 90 * 86400000),
    },
    {
      name: 'external-crm-connector-mcp',
      version: '1.2.0', publisher: 'Salesforce Integration', transport: 'remote',
      endpoint: 'https://crm-connector.company.com:4004',
      protocol_version: '2024-11-05', authentication_method: 'oauth2',
      hosting_environment: 'production', deployment_location: 'external',
      technical_owner: 'crm-team@company.com',
      business_owner: 'VP Sales',
      approved_use_case: 'CRM data synchronisation and deal pipeline management for AI sales assistant',
      data_classification: 'confidential', risk_tier: 'high', status: 'approved',
      trusted_publisher: true,
      downstream_systems: ['salesforce', 'marketing-automation', 'analytics-platform'],
      expiration_date: new Date(Date.now() + 365 * 86400000),
    },
    {
      name: 'document-intelligence-mcp',
      version: '2.0.3', publisher: 'DocAI Internal', transport: 'local',
      endpoint: 'http://docai.internal:4005',
      protocol_version: '2024-11-05', authentication_method: 'jwt',
      hosting_environment: 'production', deployment_location: 'us-east-1',
      technical_owner: 'docai-team@company.com',
      business_owner: 'Operations Director',
      approved_use_case: 'Document parsing, PII redaction, and classification for inbound contract processing',
      data_classification: 'confidential', risk_tier: 'moderate', status: 'approved',
      trusted_publisher: true,
      downstream_systems: ['contract-management', 'compliance-vault', 'archive'],
      expiration_date: new Date(Date.now() + 270 * 86400000),
    },
  ];

  for (const s of servers) {
    await query(`
      INSERT INTO mcp_governance.mcp_servers
        (name, version, publisher, transport, endpoint, protocol_version,
         authentication_method, hosting_environment, deployment_location,
         technical_owner, business_owner, approved_use_case,
         data_classification, risk_tier, status, trusted_publisher,
         downstream_systems, expiration_date)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
      WHERE NOT EXISTS (SELECT 1 FROM mcp_governance.mcp_servers WHERE name = $1)
    `, [
      s.name, s.version, s.publisher, s.transport, s.endpoint,
      s.protocol_version, s.authentication_method, s.hosting_environment,
      s.deployment_location, s.technical_owner, s.business_owner,
      s.approved_use_case, s.data_classification, s.risk_tier, s.status,
      s.trusted_publisher, s.downstream_systems, s.expiration_date,
    ]);
    log(s.name);
  }
}

// ─── 2. Tool Definitions ─────────────────────────────────────────────────────

async function seedTools() {
  section('Tool Definitions');

  const toolsByServer = {
    'demo-customer-data-connector-mcp': [
      { name: 'get_customer_profile', desc: 'Retrieve full customer profile by ID', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['customer:read'] },
      { name: 'search_customers', desc: 'Full-text search across customer database', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['customer:read'] },
      { name: 'update_customer_data', desc: 'Update mutable customer fields (address, preferences)', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['customer:write'] },
      { name: 'export_customer_data', desc: 'Export bulk customer dataset to CSV/JSON', behavior: 'read', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'denied', downstream_systems: ['analytics-bucket', 's3-export'], required_scopes: ['customer:export'] },
      { name: 'delete_customer_record', desc: 'Permanently delete a customer record (GDPR right-to-erasure)', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: true, external_communication: false, approval_status: 'denied', required_scopes: ['customer:delete', 'gdpr:erasure'] },
      { name: 'get_pii_demographics', desc: 'Retrieve PII fields: DOB, SSN, government ID', behavior: 'read', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['customer:pii'] },
      { name: 'anonymize_customer', desc: 'Replace PII with anonymized tokens in-place', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['customer:write', 'gdpr:anonymize'] },
    ],
    'demo-finance-reporting-mcp': [
      { name: 'generate_quarterly_report', desc: 'Compile and render quarterly P&L report', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['finance:read'] },
      { name: 'get_ytd_summary', desc: 'Retrieve year-to-date financial summary', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['finance:read'] },
      { name: 'export_to_excel', desc: 'Export financial tables to Excel workbook', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['sharepoint'], required_scopes: ['finance:export'] },
      { name: 'query_cost_centers', desc: 'Query spend by cost center and period', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['finance:read'] },
      { name: 'run_variance_analysis', desc: 'Compare actual vs budget with variance flags', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['finance:read', 'budget:read'] },
      { name: 'publish_board_pack', desc: 'Publish compiled financials to board portal', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['board-portal', 'investor-relations-vault'], required_scopes: ['finance:publish', 'board:write'] },
    ],
    'demo-payment-processor-mcp': [
      { name: 'process_payment', desc: 'Submit a payment transaction to the payment gateway', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['stripe', 'fraud-detection'], required_scopes: ['payment:write'] },
      { name: 'refund_transaction', desc: 'Issue full or partial refund for a completed transaction', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['stripe'], required_scopes: ['payment:refund'] },
      { name: 'get_transaction_history', desc: 'Query transaction history for an account', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['payment:read'] },
      { name: 'authorize_charge', desc: 'Pre-authorize a charge without capturing funds', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['stripe'], required_scopes: ['payment:authorize'] },
      { name: 'void_transaction', desc: 'Void an authorized transaction before capture', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['stripe'], required_scopes: ['payment:void'] },
      { name: 'batch_settlement', desc: 'Trigger end-of-day batch settlement for pending transactions', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'denied', downstream_systems: ['stripe', 'bank-clearing'], required_scopes: ['payment:settle', 'batch:admin'] },
      { name: 'get_fraud_score', desc: 'Retrieve ML fraud risk score for a transaction', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['fraud-detection'], required_scopes: ['fraud:read'] },
    ],
    'financial-ledger-access-mcp': [
      { name: 'read_journal_entries', desc: 'Query general ledger journal entries by period and account', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['ledger:read'] },
      { name: 'write_journal_entry', desc: 'Post a new journal entry to the general ledger', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['sap-erp'], required_scopes: ['ledger:write'] },
      { name: 'reconcile_accounts', desc: 'Run automated reconciliation between sub-ledger and GL', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['ledger:reconcile'] },
      { name: 'generate_trial_balance', desc: 'Generate trial balance report for a given period', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['ledger:read', 'reports:read'] },
      { name: 'post_accrual_batch', desc: 'Post month-end accrual entries in batch', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['sap-erp', 'compliance-vault'], required_scopes: ['ledger:write', 'batch:admin'] },
    ],
    'hr-employee-data-mcp': [
      { name: 'get_employee_record', desc: 'Retrieve complete employee record including PII', behavior: 'read', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: false, approval_status: 'pending', required_scopes: ['hr:read', 'pii:access'] },
      { name: 'search_employees', desc: 'Search employees by name, department, or role', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'pending', required_scopes: ['hr:read'] },
      { name: 'update_compensation', desc: 'Modify an employee\'s salary, bonus, or equity record', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['workday', 'payroll-system'], required_scopes: ['hr:comp:write'] },
      { name: 'access_performance_reviews', desc: 'Read performance review history and ratings', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'pending', required_scopes: ['hr:perf:read'] },
      { name: 'get_salary_history', desc: 'Retrieve full compensation history for an employee', behavior: 'read', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: false, approval_status: 'pending', required_scopes: ['hr:comp:read', 'pii:access'] },
      { name: 'export_headcount_report', desc: 'Export full headcount and org chart data', behavior: 'read', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'pending', downstream_systems: ['analytics-platform'], required_scopes: ['hr:export'] },
    ],
    'code-execution-sandbox-mcp': [
      { name: 'execute_python_code', desc: 'Execute arbitrary Python code in an isolated container', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: true, external_communication: false, approval_status: 'allowed', required_scopes: ['sandbox:exec'] },
      { name: 'execute_sql_query', desc: 'Run a SQL query against the sandbox read-replica', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['sandbox:sql'] },
      { name: 'run_bash_script', desc: 'Execute a bash script in the sandbox environment', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: true, external_communication: false, approval_status: 'denied', required_scopes: ['sandbox:bash', 'sandbox:admin'] },
      { name: 'install_package', desc: 'Install a Python or npm package into the sandbox', behavior: 'write', privilege_level: 'critical', classification: 'T4', destructive: false, external_communication: true, approval_status: 'denied', downstream_systems: ['pypi', 'npmjs'], required_scopes: ['sandbox:install'] },
      { name: 'read_sandbox_filesystem', desc: 'Read files from the sandbox working directory', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['sandbox:fs:read'] },
      { name: 'write_sandbox_filesystem', desc: 'Write or create files in the sandbox working directory', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: true, external_communication: false, approval_status: 'allowed', required_scopes: ['sandbox:fs:write'] },
    ],
    'external-crm-connector-mcp': [
      { name: 'get_crm_contact', desc: 'Retrieve a Salesforce contact record by ID or email', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['salesforce'], required_scopes: ['crm:read'] },
      { name: 'create_crm_contact', desc: 'Create a new contact in Salesforce', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['salesforce', 'marketing-automation'], required_scopes: ['crm:write'] },
      { name: 'update_deal_stage', desc: 'Advance or modify an opportunity through the sales pipeline', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['salesforce'], required_scopes: ['crm:deals:write'] },
      { name: 'sync_activities', desc: 'Bi-directionally sync call and email activity logs', behavior: 'write', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['salesforce', 'email-platform'], required_scopes: ['crm:sync'] },
      { name: 'export_contact_list', desc: 'Export filtered contact list to CSV', behavior: 'read', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: true, approval_status: 'allowed', downstream_systems: ['analytics-platform'], required_scopes: ['crm:export'] },
    ],
    'document-intelligence-mcp': [
      { name: 'parse_pdf', desc: 'Extract structured text and metadata from a PDF document', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['doc:read'] },
      { name: 'extract_named_entities', desc: 'Run NER pipeline to identify people, organizations, dates', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['doc:analyze'] },
      { name: 'classify_document', desc: 'Classify document type and sensitivity tier', behavior: 'read', privilege_level: 'low', classification: 'T1', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['doc:classify'] },
      { name: 'redact_pii_content', desc: 'In-place PII redaction using pattern library and ML', behavior: 'write', privilege_level: 'high', classification: 'T3', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['doc:redact', 'pii:write'] },
      { name: 'generate_document_summary', desc: 'Generate AI-powered executive summary of document', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['doc:summarize'] },
      { name: 'convert_to_structured_data', desc: 'Convert semi-structured document (invoice, contract) to JSON', behavior: 'read', privilege_level: 'moderate', classification: 'T2', destructive: false, external_communication: false, approval_status: 'allowed', required_scopes: ['doc:convert'] },
    ],
  };

  for (const [serverName, tools] of Object.entries(toolsByServer)) {
    const serverId = await lookupServer(serverName);
    if (!serverId) { console.log(`  ⚠  server not found: ${serverName}`); continue; }
    for (const t of tools) {
      await query(`
        INSERT INTO mcp_governance.mcp_tools
          (server_id, name, description, behavior, privilege_level, classification,
           destructive, external_communication, approval_status,
           downstream_systems, required_scopes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT (server_id, name) DO NOTHING
      `, [
        serverId, t.name, t.desc, t.behavior, t.privilege_level, t.classification,
        t.destructive, t.external_communication, t.approval_status,
        t.downstream_systems ?? [], t.required_scopes ?? [],
      ]);
    }
    log(`${tools.length} tools → ${serverName}`);
  }
}

// ─── 3. Redaction Patterns ───────────────────────────────────────────────────

async function seedRedactionPatterns() {
  section('Redaction Patterns');
  const patterns = [
    { name: 'Credit Card Number', pattern: '\\b\\d{4}[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}[\\s\\-]?\\d{4}\\b', enabled: true },
    { name: 'US Social Security Number', pattern: '\\b\\d{3}-\\d{2}-\\d{4}\\b', enabled: true },
    { name: 'Email Address', pattern: '\\b[A-Za-z0-9._%+\\-]+@[A-Za-z0-9.\\-]+\\.[A-Za-z]{2,}\\b', enabled: true },
    { name: 'US Phone Number', pattern: '\\b(\\+1[\\s\\-]?)?\\(?\\d{3}\\)?[\\s\\-]?\\d{3}[\\s\\-]?\\d{4}\\b', enabled: true },
    { name: 'IBAN Bank Account', pattern: '\\b[A-Z]{2}\\d{2}[A-Z0-9]{4}\\d{7}([A-Z0-9]{0,16})\\b', enabled: true },
    { name: 'JSON Web Token', pattern: '\\beyJ[A-Za-z0-9\\-_]+\\.[A-Za-z0-9\\-_]+\\.[A-Za-z0-9\\-_]*\\b', enabled: true },
    { name: 'API Key Pattern', pattern: '\\b(sk|pk|rk|api|key)[\\-_][A-Za-z0-9]{20,}\\b', enabled: true },
    { name: 'AWS Access Key ID', pattern: '\\bAKIA[A-Z0-9]{16}\\b', enabled: true },
    { name: 'Inline Password Assignment', pattern: '(?i)(password|passwd|secret)[\\s]*[=:][\\s]*\\S+', enabled: true },
    { name: 'PEM Private Key Block', pattern: '-----BEGIN[\\s\\w]+PRIVATE KEY-----', enabled: true },
    { name: 'IPv4 Address (Internal RFC1918)', pattern: '\\b(10\\.\\d{1,3}|172\\.(1[6-9]|2\\d|3[01])|192\\.168)\\.\\d{1,3}\\.\\d{1,3}\\b', enabled: true },
    { name: 'Date of Birth', pattern: '\\b(DOB|date[\\s_]of[\\s_]birth)[:\\s]+\\d{1,2}[/\\-]\\d{1,2}[/\\-]\\d{2,4}\\b', enabled: true },
  ];

  for (const p of patterns) {
    await query(`
      INSERT INTO mcp_governance.redaction_patterns (name, pattern, enabled)
      VALUES ($1, $2, $3)
      ON CONFLICT (name) DO NOTHING
    `, [p.name, p.pattern, p.enabled]);
    log(p.name);
  }
}

// ─── 4. MCP Clients ──────────────────────────────────────────────────────────

async function seedMcpClients() {
  section('MCP Clients & Connections');
  const clients = [
    { name: 'prod-n8n-cloud', client_type: 'n8n_workflow', environment: 'production', identity: 'n8n-cloud-ea2sa-prod' },
    { name: 'staging-agent-runtime', client_type: 'agent', environment: 'test', identity: 'agent-staging-v0.9' },
    { name: 'dev-local-agent', client_type: 'claude_desktop', environment: 'development', identity: 'claude-desktop-dev' },
  ];

  for (const c of clients) {
    await query(`
      INSERT INTO mcp_governance.mcp_clients
        (name, client_type, environment, identity)
      SELECT $1,$2,$3,$4
      WHERE NOT EXISTS (SELECT 1 FROM mcp_governance.mcp_clients WHERE name = $1)
    `, [c.name, c.client_type, c.environment, c.identity]);
    log(c.name);
  }

  // Wire production client to the approved servers
  const approvedServers = ['demo-finance-reporting-mcp', 'financial-ledger-access-mcp',
    'code-execution-sandbox-mcp', 'external-crm-connector-mcp', 'document-intelligence-mcp'];
  const clientRes = await query(`SELECT id FROM mcp_governance.mcp_clients WHERE name = 'prod-n8n-cloud'`);
  const clientId = clientRes.rows[0]?.id;
  if (clientId) {
    for (const serverName of approvedServers) {
      const serverId = await lookupServer(serverName);
      if (serverId) {
        await query(`
          INSERT INTO mcp_governance.mcp_client_servers (client_id, server_id)
          VALUES ($1, $2)
          ON CONFLICT (client_id, server_id) DO NOTHING
        `, [clientId, serverId]);
      }
    }
    log('prod-n8n-cloud connected to 5 approved servers');
  }
}

// ─── 5. Server Status History ─────────────────────────────────────────────────

async function seedStatusHistory() {
  section('Server Status History');
  const histories = [
    { server: 'hr-employee-data-mcp', transitions: [
      { from_status: null, to_status: 'pending_review', reason: 'Initial registration submitted by HR Platform Team', days_ago: 14 },
      { from_status: 'pending_review', to_status: 'pending_review', reason: 'Additional documentation requested: data flow diagram and DPIA required', days_ago: 10 },
    ]},
    { server: 'financial-ledger-access-mcp', transitions: [
      { from_status: null, to_status: 'pending_review', reason: 'Initial registration', days_ago: 60 },
      { from_status: 'pending_review', to_status: 'approved', reason: 'DPIA completed, security scan passed, approved for ledger write access', days_ago: 45 },
    ]},
    { server: 'demo-payment-processor-mcp', transitions: [
      { from_status: null, to_status: 'pending_review', reason: 'Initial registration — pending PCI-DSS attestation', days_ago: 30 },
    ]},
    { server: 'demo-customer-data-connector-mcp', transitions: [
      { from_status: null, to_status: 'pending_review', reason: 'Initial registration', days_ago: 45 },
      { from_status: 'pending_review', to_status: 'pending_review', reason: 'GDPR impact assessment in progress — awaiting DPO sign-off', days_ago: 20 },
    ]},
  ];

  for (const h of histories) {
    const serverId = await lookupServer(h.server);
    if (!serverId) continue;
    for (const t of h.transitions) {
      const changedAt = new Date(Date.now() - t.days_ago * 86400000);
      await query(`
        INSERT INTO mcp_governance.mcp_server_status_history
          (server_id, from_status, to_status, reason, changed_at)
        VALUES ($1,$2,$3,$4,$5)
      `, [serverId, t.from_status, t.to_status, t.reason, changedAt]);
    }
    log(h.server);
  }
}

// ─── 6. Assurance Evidence ────────────────────────────────────────────────────

async function seedAssuranceEvidence() {
  section('Assurance Evidence');
  const evidences = [
    {
      server: 'financial-ledger-access-mcp', evidence_type: 'config_export', status: 'validated',
      source_system: 'semgrep-ci', validated_by: 'security-team@company.com', days_ago: 44,
      evidence: { scan_tool: 'Semgrep', findings: { critical: 0, high: 0, medium: 2, info: 5 }, outcome: 'pass', notes: 'All medium findings reviewed and accepted as non-exploitable in production context.' },
    },
    {
      server: 'code-execution-sandbox-mcp', evidence_type: 'redeployment_recovery_tested', status: 'validated',
      source_system: 'chaos-engineering', validated_by: 'devops@company.com', days_ago: 20,
      evidence: { test_type: 'sandbox_isolation', result: 'pass', container_breakout_attempted: true, container_breakout_succeeded: false, filesystem_escape_attempted: true, filesystem_escape_succeeded: false },
    },
    {
      server: 'external-crm-connector-mcp', evidence_type: 'credential_rotation_verified', status: 'validated',
      source_system: 'secrets-manager', validated_by: 'it-security@company.com', days_ago: 30,
      evidence: { rotation_method: 'automated', rotation_period_days: 90, last_rotated: new Date(Date.now() - 30 * 86400000).toISOString(), next_rotation: new Date(Date.now() + 60 * 86400000).toISOString() },
    },
    {
      server: 'financial-ledger-access-mcp', evidence_type: 'authorization_revocation_tested', status: 'validated',
      source_system: 'access-control-audit', validated_by: 'iam-team@company.com', days_ago: 45,
      evidence: { test_type: 'token_revocation', revocation_time_seconds: 12, propagation_verified: true, downstream_systems_tested: ['sap-erp', 'reporting-warehouse'] },
    },
    {
      server: 'document-intelligence-mcp', evidence_type: 'config_export', status: 'validated',
      source_system: 'dast-scanner', validated_by: 'appsec@company.com', days_ago: 15,
      evidence: { scan_type: 'DAST', owasp_top10: 'pass', injection_tests: 'pass', findings: { critical: 0, high: 0, medium: 0 } },
    },
    {
      server: 'demo-finance-reporting-mcp', evidence_type: 'config_export', status: 'validated',
      source_system: 'annual-review', validated_by: 'security-team@company.com', days_ago: 90,
      evidence: { review_type: 'annual_security_review', sharepoint_destination: 'allowlisted', data_leakage_review: 'pass', export_path_audit: 'clean' },
    },
  ];

  for (const e of evidences) {
    const serverId = await lookupServer(e.server);
    if (!serverId) continue;
    const observedAt = new Date(Date.now() - e.days_ago * 86400000);
    const existing = await query(
      `SELECT id FROM mcp_governance.mcp_assurance_evidence WHERE server_id = $1 AND evidence_type = $2 AND source_system = $3`,
      [serverId, e.evidence_type, e.source_system]
    );
    if (existing.rows.length > 0) { log(`already exists: ${e.evidence_type} → ${e.server}`); continue; }
    await query(`
      INSERT INTO mcp_governance.mcp_assurance_evidence
        (server_id, evidence_type, status, evidence, source_system, validated_by, validated_at, observed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
    `, [serverId, e.evidence_type, e.status, JSON.stringify(e.evidence), e.source_system, e.validated_by, observedAt]);
    log(`${e.evidence_type} → ${e.server}`);
  }
}

// ─── 7. Demo Violations ───────────────────────────────────────────────────────

async function seedViolations() {
  section('Demo Violations');

  // Only seed if we have fewer than 5 violations (avoids duplicate demo runs)
  const existing = await query('SELECT COUNT(*) FROM governance.violations');
  if (parseInt(existing.rows[0].count) >= 5) {
    log('violations already populated — skipping');
    return;
  }

  const wfIds = await pickWorkflowIds(4);
  const servers = await query(`SELECT id, name FROM mcp_governance.mcp_servers WHERE status IN ('pending_review','approved') ORDER BY risk_tier DESC LIMIT 6`);

  const specs = [
    {
      entity_type: 'mcp_server', entity_id: () => servers.rows.find(s => s.name.includes('payment'))?.id ?? servers.rows[0].id,
      policy: 'MCP Server Registration Required', condition: 'mcp_unregistered',
      severity: 'critical', status: 'open', days_ago: 3,
      message: 'demo-payment-processor-mcp is operating in production without completing the mandatory registration and approval workflow. Immediate review required — payment tools are pending approval.',
    },
    {
      entity_type: 'mcp_server', entity_id: () => servers.rows.find(s => s.name.includes('hr'))?.id ?? servers.rows[1].id,
      policy: 'MCP Stale Assurance Evidence', condition: 'stale_assurance_evidence',
      severity: 'high', status: 'open', days_ago: 7,
      message: 'hr-employee-data-mcp has no current assurance evidence on file. Server is in pending_review status with no DPIA or security scan results submitted. Assurance evidence required before approval can proceed.',
    },
    {
      entity_type: 'mcp_server', entity_id: () => servers.rows.find(s => s.name.includes('customer'))?.id ?? servers.rows[2].id,
      policy: 'MCP Tool Allowlist — Denied Tools Only', condition: 'tool_explicitly_denied',
      severity: 'high', status: 'acknowledged', days_ago: 12,
      message: 'demo-customer-data-connector-mcp has tools explicitly denied (export_customer_data, delete_customer_record) that were called by workflow execution. Tool calls were blocked by enforcement policy but the attempted access constitutes a governance violation.',
    },
    {
      entity_type: 'mcp_server', entity_id: () => servers.rows.find(s => s.name.includes('code-execution'))?.id ?? servers.rows[3].id,
      policy: 'MCP Tool Allowlist Enforcement', condition: 'tool_not_in_allowlist',
      severity: 'high', status: 'open', days_ago: 1,
      message: 'code-execution-sandbox-mcp attempted to invoke run_bash_script and install_package — both are in the denied tool list. Execution was blocked. Root cause analysis pending: workflow ai-governance:NpzWJdM3VlN5ltlJ submitted both calls within 30 seconds.',
    },
    {
      entity_type: 'workflow', entity_id: () => wfIds[0] ?? 'unknown',
      policy: 'Data Lineage', condition: 'pii_in_output',
      severity: 'critical', status: 'open', days_ago: 2,
      message: 'PII egress detected in lineage chain. Workflow output included unredacted customer SSN and email address forwarded to analytics-platform destination. Redaction pattern should have been applied by document-intelligence-mcp but was bypassed.',
    },
    {
      entity_type: 'workflow', entity_id: () => wfIds[1] ?? 'unknown',
      policy: 'Behavioral Anomaly', condition: 'unexpected_tool',
      severity: 'high', status: 'open', days_ago: 0,
      message: 'Workflow executed tool sequence deviating significantly from established baseline. Baseline: [get_customer_profile, validate_pii, run_compliance_check]. Observed: [get_customer_profile, get_pii_demographics, export_customer_data]. Unexpected tool export_customer_data is a denied tool.',
    },
    {
      entity_type: 'mcp_server', entity_id: () => servers.rows.find(s => s.name.includes('payment'))?.id ?? servers.rows[0].id,
      policy: 'MCP Credential Exposure — Critical', condition: 'credential_in_tool_output',
      severity: 'critical', status: 'waiver_requested', days_ago: 18,
      message: 'Credential exposure detected: Stripe secret key pattern matched in tool response from get_transaction_history. Tool output contained a partially masked secret (sk-live-****) that was not fully redacted before being forwarded downstream.',
    },
    {
      entity_type: 'mcp_server', entity_id: () => servers.rows.find(s => s.name.includes('legacy'))?.id ?? servers.rows[4 % servers.rows.length].id,
      policy: 'MCP Approval Expiration Block', condition: 'approval_expired',
      severity: 'medium', status: 'resolved', days_ago: 45,
      message: 'demo-legacy-reporting-mcp approval expired 45 days ago. Server has since been retired. Violation resolved when server was marked retired and removed from active routing.',
    },
  ];

  for (const spec of specs) {
    const policyId = await lookupPolicy(spec.policy);
    if (!policyId) { console.log(`  ⚠  policy not found: ${spec.policy}`); continue; }

    const ruleRes = await query(`
      SELECT id FROM governance.policy_rules
      WHERE policy_id = $1
      LIMIT 1
    `, [policyId]);
    const ruleId = ruleRes.rows[0]?.id;
    if (!ruleId) { console.log(`  ⚠  no rule for policy: ${spec.policy}`); continue; }

    const entityId = spec.entity_id();
    if (!entityId || entityId === 'unknown') { console.log(`  ⚠  no entity for: ${spec.message.slice(0, 40)}`); continue; }

    const detectedAt = new Date(Date.now() - spec.days_ago * 86400000);
    const resolvedAt = spec.status === 'resolved' ? new Date(Date.now() - (spec.days_ago - 5) * 86400000) : null;

    await query(`
      INSERT INTO governance.violations
        (rule_id, policy_id, severity, message, status, entity_type, entity_id, detected_at, resolved_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
    `, [ruleId, policyId, spec.severity, spec.message, spec.status,
        spec.entity_type, entityId, detectedAt, resolvedAt]);
    log(`${spec.severity} ${spec.status} → ${spec.entity_type}`);
  }
}

// ─── 8. Behavior Baselines ────────────────────────────────────────────────────

async function seedBehaviorBaselines() {
  section('Behavior Baselines');
  const wfIds = await pickWorkflowIds(4);
  if (wfIds.length === 0) { log('no workflows to baseline'); return; }

  const baselines = [
    {
      wf: wfIds[0],
      typical_tool_sequence: ['get_customer_profile', 'validate_pii', 'run_compliance_check', 'publish_result'],
      known_tools: ['get_customer_profile', 'validate_pii', 'run_compliance_check', 'publish_result', 'search_customers'],
      known_destinations: ['compliance-vault.internal', 'audit-log.internal'],
      avg_latency_ms: 1240, p95_latency_ms: 2850, stddev_latency_ms: 310,
      avg_node_count: 9, max_loop_depth: 1, sample_count: 487,
    },
    {
      wf: wfIds[1],
      typical_tool_sequence: ['get_ytd_summary', 'query_cost_centers', 'run_variance_analysis', 'export_to_excel', 'publish_board_pack'],
      known_tools: ['get_ytd_summary', 'query_cost_centers', 'run_variance_analysis', 'export_to_excel'],
      known_destinations: ['sharepoint.company.com', 'reporting-warehouse.internal'],
      avg_latency_ms: 3600, p95_latency_ms: 7200, stddev_latency_ms: 820,
      avg_node_count: 14, max_loop_depth: 0, sample_count: 124,
    },
    {
      wf: wfIds[2],
      typical_tool_sequence: ['parse_pdf', 'extract_named_entities', 'classify_document', 'redact_pii_content', 'generate_document_summary'],
      known_tools: ['parse_pdf', 'extract_named_entities', 'classify_document', 'redact_pii_content', 'generate_document_summary'],
      known_destinations: ['contract-management.internal', 'archive.internal'],
      avg_latency_ms: 890, p95_latency_ms: 2100, stddev_latency_ms: 220,
      avg_node_count: 7, max_loop_depth: 0, sample_count: 893,
    },
  ];

  for (const b of baselines) {
    await query(`
      INSERT INTO workflow_governance.behavior_baselines
        (workflow_id, typical_tool_sequence, known_tools, known_destinations,
         avg_latency_ms, p95_latency_ms, stddev_latency_ms,
         avg_node_count, max_loop_depth, sample_count, computed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW() - INTERVAL '2 hours')
      ON CONFLICT (workflow_id) DO UPDATE SET
        avg_latency_ms = EXCLUDED.avg_latency_ms,
        sample_count = EXCLUDED.sample_count,
        computed_at = EXCLUDED.computed_at
    `, [
      b.wf,
      JSON.stringify(b.typical_tool_sequence),
      JSON.stringify(b.known_tools),
      JSON.stringify(b.known_destinations),
      b.avg_latency_ms, b.p95_latency_ms, b.stddev_latency_ms,
      b.avg_node_count, b.max_loop_depth, b.sample_count,
    ]);
    log(`baseline → ${b.wf.slice(0, 8)}… (${b.sample_count} samples)`);
  }
}

// ─── 9. Anomaly Alerts ────────────────────────────────────────────────────────

async function seedAnomalyAlerts() {
  section('Anomaly Alerts');
  const wfIds = await pickWorkflowIds(3);
  if (wfIds.length === 0) { log('no workflows for alerts'); return; }

  const alerts = [
    {
      wf: wfIds[0], correlation_id: 'corr-demo-001',
      alert_type: 'unexpected_tool', deviation_score: 87.4,
      severity: 'high', status: 'open', days_ago: 0,
      details: { unexpected_tool: 'export_customer_data', expected_tools: ['get_customer_profile', 'validate_pii', 'run_compliance_check'], execution_time_ms: 1380, baseline_sample_count: 487 },
    },
    {
      wf: wfIds[1], correlation_id: 'corr-demo-002',
      alert_type: 'latency_spike', deviation_score: 72.1,
      severity: 'medium', status: 'acknowledged', days_ago: 1,
      details: { observed_latency_ms: 19400, baseline_avg_ms: 3600, baseline_p95_ms: 7200, z_score: 4.2, baseline_stddev_ms: 820 },
    },
    {
      wf: wfIds[2], correlation_id: 'corr-demo-003',
      alert_type: 'new_destination', deviation_score: 91.0,
      severity: 'high', status: 'open', days_ago: 0,
      details: { new_destination: 'external-analytics.thirdparty.com', known_destinations: ['contract-management.internal', 'archive.internal'], first_seen_at: new Date().toISOString() },
    },
    {
      wf: wfIds[0], correlation_id: 'corr-demo-004',
      alert_type: 'excessive_loop', deviation_score: 65.3,
      severity: 'high', status: 'resolved', days_ago: 5,
      details: { loop_depth: 7, baseline_max_loop_depth: 1, affected_tool: 'get_customer_profile', loop_chain_length: 7 },
    },
    {
      wf: wfIds[1], correlation_id: 'corr-demo-005',
      alert_type: 'unexpected_tool', deviation_score: 78.9,
      severity: 'critical', status: 'open', days_ago: 0,
      details: { unexpected_tool: 'publish_board_pack', context: 'Tool called outside board reporting window; expected only during month-end close', expected_tools: ['get_ytd_summary', 'query_cost_centers', 'run_variance_analysis', 'export_to_excel'] },
    },
  ];

  for (const a of alerts) {
    const createdAt = new Date(Date.now() - a.days_ago * 86400000);
    await query(`
      INSERT INTO workflow_governance.anomaly_alerts
        (workflow_id, correlation_id, alert_type, deviation_score,
         details_json, severity, status, created_at)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8
      WHERE NOT EXISTS (
        SELECT 1 FROM workflow_governance.anomaly_alerts WHERE correlation_id = $2
      )
    `, [
      a.wf, a.correlation_id, a.alert_type, a.deviation_score,
      JSON.stringify(a.details), a.severity, a.status, createdAt,
    ]);
    log(`${a.alert_type} (score ${a.deviation_score}) → ${a.status}`);
  }
}

// ─── 10. Lineage Chains ───────────────────────────────────────────────────────

async function seedLineageChains() {
  section('Lineage Chains');
  const existing = await query(
    `SELECT COUNT(*) FROM workflow_governance.lineage_nodes WHERE correlation_id LIKE 'lineage-demo-%'`
  );
  if (parseInt(existing.rows[0].count) >= 5) {
    log('demo lineage chains already populated — skipping');
    return;
  }

  const wfIds = await pickWorkflowIds(2);

  async function insertChain(correlationId, nodes) {
    const insertedIds = [];
    for (const n of nodes) {
      const res = await query(`
        INSERT INTO workflow_governance.lineage_nodes
          (correlation_id, node_type, node_id, node_name, service_name,
           data_classification, is_external, metadata_json)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING id
      `, [correlationId, n.node_type, n.node_id, n.node_name, n.service_name,
          n.data_classification, n.is_external ?? false, JSON.stringify(n.metadata)]);
      insertedIds.push(res.rows[0].id);
    }
    for (let i = 0; i < insertedIds.length - 1; i++) {
      await query(`
        INSERT INTO workflow_governance.lineage_edges
          (from_node_id, to_node_id, transformation_type)
        VALUES ($1,$2,$3)
      `, [insertedIds[i], insertedIds[i + 1], nodes[i + 1].edge_type ?? 'call']);
    }
    log(`${correlationId} (${nodes.length} nodes)`);
  }

  await insertChain('lineage-demo-payment-001', [
    { node_id: wfIds[0] ?? 'wf-pay', node_type: 'workflow', node_name: 'Payment Reconciliation', service_name: 'n8n-cloud', data_classification: 'internal', metadata: { workflow_id: wfIds[0] } },
    { node_id: 'demo-payment-processor-mcp', node_type: 'mcp_server', node_name: 'demo-payment-processor-mcp', service_name: 'mcp-governance', data_classification: 'confidential', metadata: { protocol_version: '2024-11-05' } },
    { node_id: 'get_transaction_history', node_type: 'tool', node_name: 'get_transaction_history', service_name: 'demo-payment-processor-mcp', data_classification: 'confidential', metadata: { approval_status: 'allowed', latency_ms: 312 } },
    { node_id: 'process_payment', node_type: 'tool', node_name: 'process_payment', service_name: 'demo-payment-processor-mcp', data_classification: 'restricted', metadata: { approval_status: 'pending', risk_flag: true, latency_ms: 780 } },
    { node_id: 'api.stripe.com', node_type: 'external_api', node_name: 'Stripe Payment API', service_name: 'stripe', data_classification: 'restricted', is_external: true, metadata: { destination: 'api.stripe.com', latency_ms: 540 }, edge_type: 'forward' },
  ]);

  await insertChain('lineage-demo-pii-002', [
    { node_id: wfIds[1] ?? wfIds[0] ?? 'wf-pii', node_type: 'workflow', node_name: 'Customer PII Extraction', service_name: 'n8n-cloud', data_classification: 'pii', metadata: { risk_flag: true } },
    { node_id: 'demo-customer-data-connector-mcp', node_type: 'mcp_server', node_name: 'demo-customer-data-connector-mcp', service_name: 'mcp-governance', data_classification: 'pii', metadata: {} },
    { node_id: 'get_pii_demographics', node_type: 'tool', node_name: 'get_pii_demographics', service_name: 'demo-customer-data-connector-mcp', data_classification: 'pii', metadata: { pii_types: ['SSN', 'DOB', 'email'], latency_ms: 210 } },
    { node_id: 'export_customer_data_blocked', node_type: 'tool', node_name: 'export_customer_data', service_name: 'demo-customer-data-connector-mcp', data_classification: 'pii', metadata: { approval_status: 'denied', blocked: true, block_reason: 'enforcement_policy' } },
  ]);
}

// ─── 11. Attack Paths ─────────────────────────────────────────────────────────

async function seedAttackPaths() {
  section('Attack Paths');
  const paths = [
    {
      server: 'demo-payment-processor-mcp',
      risk_score: 88,
      reachable_tools: ['process_payment', 'refund_transaction', 'authorize_charge', 'batch_settlement', 'void_transaction', 'get_transaction_history', 'get_fraud_score'],
      external_destinations: ['api.stripe.com', 'bank-clearing.external.com', 'fraud-detection.internal'],
      cross_server_paths: [{ server: 'demo-customer-data-connector-mcp', via: 'workflow-orchestration', risk: 'credential-chaining' }],
      risk_factors: { tool_count: 7, high_risk_tools: ['process_payment', 'refund_transaction', 'batch_settlement', 'authorize_charge'], external_destinations: 2, pii_destinations: 0, cross_server_peers: 1, pending_approval: true, no_pci_attestation: true },
    },
    {
      server: 'hr-employee-data-mcp',
      risk_score: 94,
      reachable_tools: ['get_employee_record', 'search_employees', 'update_compensation', 'access_performance_reviews', 'get_salary_history', 'export_headcount_report'],
      external_destinations: ['workday.com', 'payroll-system.internal', 'analytics-platform.internal'],
      cross_server_paths: [],
      risk_factors: { tool_count: 6, high_risk_tools: ['get_employee_record', 'update_compensation', 'get_salary_history', 'export_headcount_report'], external_destinations: 1, pii_destinations: 3, cross_server_peers: 0, no_dpia: true, no_assurance_evidence: true },
    },
    {
      server: 'code-execution-sandbox-mcp',
      risk_score: 79,
      reachable_tools: ['execute_python_code', 'execute_sql_query', 'run_bash_script', 'install_package', 'read_sandbox_filesystem', 'write_sandbox_filesystem'],
      external_destinations: ['pypi.org', 'npmjs.com', 'artifact-store.internal'],
      cross_server_paths: [{ server: 'external-crm-connector-mcp', via: 'script-exfil', risk: 'data-exfiltration' }, { server: 'document-intelligence-mcp', via: 'file-write-read', risk: 'document-tampering' }],
      risk_factors: { tool_count: 6, high_risk_tools: ['execute_python_code', 'run_bash_script', 'install_package'], external_destinations: 2, pii_destinations: 0, cross_server_peers: 2, denied_tools_present: true },
    },
  ];

  for (const p of paths) {
    const serverId = await lookupServer(p.server);
    if (!serverId) continue;
    await query(`
      INSERT INTO workflow_governance.attack_paths
        (mcp_server_id, server_name, reachable_tools, external_destinations,
         cross_server_paths, risk_factors, risk_score, computed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() - INTERVAL '1 hour')
      ON CONFLICT (mcp_server_id) DO UPDATE SET
        risk_score = EXCLUDED.risk_score,
        risk_factors = EXCLUDED.risk_factors,
        computed_at = EXCLUDED.computed_at
    `, [
      serverId, p.server,
      JSON.stringify(p.reachable_tools),
      JSON.stringify(p.external_destinations),
      JSON.stringify(p.cross_server_paths),
      JSON.stringify(p.risk_factors),
      p.risk_score,
    ]);
    log(`risk_score=${p.risk_score} → ${p.server}`);
  }
}

// ─── 12. Additional Policies for Demo Breadth ─────────────────────────────────

async function seedAdditionalPolicies() {
  section('Additional Demo Policies');
  const policies = [
    {
      name: 'PII Egress Prevention',
      description: 'Detects and blocks unredacted PII from being forwarded to external or analytics destinations through workflow output channels.',
      status: 'active',
      rules: [
        { condition_json: { type: 'pii_in_output', fields: ['SSN', 'DOB', 'credit_card', 'email'] }, action: 'create_violation', severity: 'critical', enabled: true },
        { condition_json: { type: 'pii_to_external_destination' }, action: 'block_and_alert', severity: 'critical', enabled: true },
      ],
    },
    {
      name: 'Payment Instrument Segregation',
      description: 'Ensures MCP servers with access to payment processing tools are fully isolated from customer PII servers to prevent credential chaining attacks.',
      status: 'active',
      rules: [
        { condition_json: { type: 'cross_server_trust', server_risk_tiers: ['critical', 'critical'] }, action: 'create_violation', severity: 'high', enabled: true },
        { condition_json: { type: 'payment_tool_with_pii_access' }, action: 'block_and_alert', severity: 'critical', enabled: true },
      ],
    },
    {
      name: 'Sandbox Execution Governance',
      description: 'Governs the code execution sandbox: restricts which tools can be called, enforces output scanning, and prevents network egress from executed code.',
      status: 'active',
      rules: [
        { condition_json: { type: 'denied_tool_attempted', server_tag: 'sandbox' }, action: 'block_and_alert', severity: 'high', enabled: true },
        { condition_json: { type: 'sandbox_network_egress' }, action: 'create_violation', severity: 'critical', enabled: true },
      ],
    },
  ];

  for (const pol of policies) {
    const existing = await query('SELECT id FROM governance.policies WHERE name = $1', [pol.name]);
    if (existing.rows.length > 0) { log(`already exists: ${pol.name}`); continue; }

    const res = await query(`
      INSERT INTO governance.policies (name, description, status)
      VALUES ($1,$2,$3) RETURNING id
    `, [pol.name, pol.description, pol.status]);
    const policyId = res.rows[0].id;

    for (const r of pol.rules) {
      await query(`
        INSERT INTO governance.policy_rules (policy_id, condition_json, action, severity, enabled)
        VALUES ($1,$2,$3,$4,$5)
      `, [policyId, JSON.stringify(r.condition_json), r.action, r.severity, r.enabled]);
    }
    log(`${pol.name} (${pol.rules.length} rules)`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nIOA Governance Platform — Demo Seed\n' + '─'.repeat(44));
  try {
    await seedMcpServers();
    await seedTools();
    await seedRedactionPatterns();
    await seedMcpClients();
    await seedStatusHistory();
    await seedAssuranceEvidence();
    await seedAdditionalPolicies();
    await seedViolations();
    await seedBehaviorBaselines();
    await seedAnomalyAlerts();
    await seedLineageChains();
    await seedAttackPaths();
    console.log('\n✅  Demo seed complete.\n');
  } catch (err) {
    console.error('\n❌  Seed failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
