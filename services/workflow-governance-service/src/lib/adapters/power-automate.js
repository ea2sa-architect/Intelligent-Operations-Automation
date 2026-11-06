// Power Automate adapter — uses Dataverse Web API (supported for service principals).
// Config: { tenant_id, client_id, client_secret, environment_id, dataverse_url }
// Auth: OAuth 2.0 client credentials against Microsoft Entra ID.
//
// The Flow Management API (api.flow.microsoft.com) does NOT support service
// principal auth for listing/getting flows — it returns ClientScopeAuthorizationFailed.
// Dataverse stores cloud flows in its workflow table (category 5) and fully
// supports client-credentials tokens.

const BAP_API  = 'https://api.bap.microsoft.com';
const BAP_SCOPE = 'https://service.powerapps.com/.default';

async function getToken(config, scope) {
  const { tenant_id, client_id, client_secret } = config;
  if (!tenant_id || !client_id || !client_secret) {
    throw new Error('tenant_id, client_id, and client_secret are required');
  }
  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id,
    client_secret,
    scope,
  });
  const res = await fetch(
    `https://login.microsoftonline.com/${tenant_id}/oauth2/v2.0/token`,
    { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description ?? `Token request failed: HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function listEnvironments(config) {
  const token = await getToken(config, BAP_SCOPE);
  // Non-admin scope — only returns environments the service principal has been
  // added to (e.g. via an Application User in Dataverse), no tenant-admin
  // consent required. The admin scope (scopes/admin/environments) needs the
  // app registered as a Power Platform admin management application, which
  // is a much bigger ask than per-environment access.
  const res = await fetch(
    `${BAP_API}/providers/Microsoft.BusinessAppPlatform/environments?api-version=2023-06-01`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Could not list environments: HTTP ${res.status} — ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return (data.value ?? []).map(e => ({
    id:            e.name,
    name:          e.properties?.displayName ?? e.name,
    dataverse_url: e.properties?.linkedEnvironmentMetadata?.instanceApiUrl ?? null,
  }));
}

// Preferred path: dataverse_url entered directly in the connection config
// (copied from the environment's Dataverse "Environment URL" in the Admin
// Center). Validated with Dataverse's own WhoAmI — only needs the service
// principal to be an Application User with a security role in that
// environment, no tenant-wide Power Platform admin consent required.
//
// Fallback path: discover environments via the BAP admin API. This needs
// the app registered as a Power Platform admin management application
// (pac admin create-service-principal) or full admin consent — much more
// friction, kept only for backward compatibility / convenience when available.
async function testConnection(config) {
  if (config.dataverse_url) {
    try {
      const dvUrl   = config.dataverse_url.replace(/\/$/, '');
      const token   = await getToken(config, `${dvUrl}/.default`);
      const res     = await fetch(`${dvUrl}/api/data/v9.2/WhoAmI`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { ok: false, error: `Dataverse check failed: HTTP ${res.status} — ${body.slice(0, 500)}` };
      }
      const data = await res.json();
      return { ok: true, error: null, details: { whoami: data } };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  try {
    const environments = await listEnvironments(config);
    return { ok: true, error: null, details: { environments } };
  } catch (err) {
    return { ok: false, error: `${err.message} — alternatively, paste the environment's Dataverse URL directly into the Dataverse URL field to skip environment discovery.` };
  }
}

async function getDataverseUrl(config) {
  if (config.dataverse_url) return config.dataverse_url;
  const envs = await listEnvironments(config);
  const match = envs.find(e => e.id === config.environment_id);
  if (!match?.dataverse_url) {
    throw new Error(`No Dataverse URL found for environment ${config.environment_id}. Enter the Dataverse URL directly in the connection config.`);
  }
  return match.dataverse_url;
}

async function listWorkflows(config) {
  const dvUrl = await getDataverseUrl(config);
  const dvScope = dvUrl.replace(/\/$/, '') + '/.default';
  const token = await getToken(config, dvScope);

  const flows = [];
  let url = `${dvUrl}/api/data/v9.2/workflows?$filter=category eq 5&$select=workflowid,name,statecode,clientdata,createdon,modifiedon&$top=250`;

  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Could not list flows: HTTP ${res.status} — ${body.slice(0, 500)}`);
    }
    const data = await res.json();
    flows.push(...(data.value ?? []));
    url = data['@odata.nextLink'] ?? null;
  }

  return flows.map(f => ({
    sourceId:   f.workflowid,
    name:       f.name ?? f.workflowid,
    active:     f.statecode === 1,
    tags:       [],
    folderId:   null,
    folderName: null,
    url:        null,
    stepCount:  countActions(parseClientData(f.clientdata)),
  }));
}

async function getWorkflow(config, sourceId) {
  const dvUrl = await getDataverseUrl(config);
  const dvScope = dvUrl.replace(/\/$/, '') + '/.default';
  const token = await getToken(config, dvScope);

  const res = await fetch(
    `${dvUrl}/api/data/v9.2/workflows(${sourceId})?$select=workflowid,name,statecode,clientdata,createdon,modifiedon`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'OData-MaxVersion': '4.0', 'OData-Version': '4.0' } }
  );
  if (!res.ok) {
    if (res.status === 404) return null;
    const body = await res.text().catch(() => '');
    throw new Error(`Could not fetch flow ${sourceId}: HTTP ${res.status} — ${body.slice(0, 500)}`);
  }
  return res.json();
}

function parseClientData(clientdata) {
  if (!clientdata) return null;
  try { return JSON.parse(clientdata); } catch { return null; }
}

function countActions(definition) {
  if (!definition?.properties?.definition?.actions) return 0;
  let count = 0;
  function walk(actions) {
    for (const a of Object.values(actions)) {
      count++;
      if (a.actions) walk(a.actions);
      if (a.else?.actions) walk(a.else.actions);
    }
  }
  walk(definition.properties.definition.actions);
  return count;
}

function normalizeNodes(raw) {
  const cd = parseClientData(raw?.clientdata);
  const definition = cd?.properties?.definition;
  if (!definition?.actions) return [];
  const nodes = [];
  function walk(actions, prefix = '') {
    for (const [name, action] of Object.entries(actions)) {
      const stepId = prefix ? `${prefix}/${name}` : name;
      nodes.push({
        stepId,
        stepName:       name,
        stepType:       action.type ?? 'unknown',
        governanceType: classifyPAAction(action.type),
        riskFactors:    [],
        parametersJson: action.inputs ?? {},
      });
      if (action.actions) walk(action.actions, stepId);
      if (action.else?.actions) walk(action.else.actions, `${stepId}/else`);
    }
  }
  walk(definition.actions);
  return nodes;
}

function detectFlowLevelRisks(raw) {
  const risks = [];
  const cd = parseClientData(raw?.clientdata);
  const definition = cd?.properties?.definition;
  if (!definition) return risks;

  const json = JSON.stringify(definition);
  if (json.includes('password') || json.includes('secret') || json.includes('apikey'))
    risks.push({ factor: 'hardcoded_secret_candidate', detail: 'Flow definition references password/secret/apikey literals' });
  if (definition.triggers) {
    for (const t of Object.values(definition.triggers)) {
      if (t.type === 'Request')
        risks.push({ factor: 'public_http_trigger', detail: `HTTP request trigger: ${t.type}` });
    }
  }
  return risks;
}

function classifyPAAction(type = '') {
  const t = type.toLowerCase();
  if (t.includes('openai') || t.includes('aibuilder'))      return 'ai_inference';
  if (t.includes('sql') || t.includes('dataverse'))          return 'database';
  if (t.includes('http'))                                     return 'http';
  if (t.includes('request'))                                  return 'webhook';
  if (t.includes('recurrence') || t.includes('schedule'))    return 'schedule';
  if (t.includes('sendmail') || t.includes('teams') || t.includes('outlook')) return 'notification';
  if (t.includes('sharepointfile') || t.includes('onedrive') || t.includes('blob')) return 'storage';
  if (t === 'if' || t === 'switch' || t === 'foreach' || t === 'do_until') return 'logic';
  if (t === 'compose' || t === 'parsejson' || t === 'select' || t === 'filter') return 'transform';
  return 'unknown';
}

export default { testConnection, listWorkflows, getWorkflow, normalizeNodes, detectFlowLevelRisks, listEnvironments };
