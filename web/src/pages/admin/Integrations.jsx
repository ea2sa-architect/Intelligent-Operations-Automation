import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, RefreshCw, CheckCircle2, XCircle, AlertCircle, Plug, ChevronDown, ChevronUp, Copy, Zap, Pencil } from 'lucide-react'
import { platforms as platformsApi, apiKeys as apiKeysApi } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label, Select } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { useConfirm } from '../../hooks/useConfirm.jsx'

// ── Platform catalogue ─────────────────────────────────────────────────────
const PLATFORM_META = {
  n8n: {
    label:       'n8n',
    description: 'Self-hosted or n8n Cloud workflow automation',
    color:       'bg-orange-50 border-orange-200',
    badge:       'bg-orange-100 text-orange-700',
    fields: [
      { key: 'base_url',  label: 'Instance URL',  type: 'url',      placeholder: 'https://your-instance.app.n8n.cloud/api/v1', required: true },
      { key: 'api_key',   label: 'API Key',        type: 'password', placeholder: 'n8n_api_…', required: true },
    ],
    warning: null,
  },
  make: {
    label:       'Make.com',
    description: 'Visual automation platform (formerly Integromat)',
    color:       'bg-purple-50 border-purple-200',
    badge:       'bg-purple-100 text-purple-700',
    fields: [
      { key: 'api_key', label: 'API Key', type: 'password', placeholder: 'Your Make.com API key', required: true },
      { key: 'region',  label: 'Region',  type: 'select',   options: [{ value: 'eu1', label: 'EU (eu1)' }, { value: 'us1', label: 'US (us1)' }], required: true },
    ],
    warning: null,
  },
  zapier: {
    label:       'Zapier (Enforcement)',
    description: 'Zapier calls IOA before a Zap acts — governs execution, does not import Zaps',
    color:       'bg-orange-50 border-orange-200',
    badge:       'bg-orange-100 text-orange-700',
    // Zapier's own automations are only reachable via OAuth 2.0 + a user
    // access token (its Workflow API) — a pasted "API key" was never the
    // right shape for that, and isn't what this connection does anyway.
    // This direction is the reverse: IOA issues Zapier a credential, and
    // Zapier calls IOA's own POST /enforce before a Zap proceeds. Discovery
    // /import of Zaps via Zapier's OAuth Workflow API is a separate, later
    // phase — see ZapierEnforcementPanel's copy for the full explanation.
    kind: 'enforcement',
  },
  power_automate: {
    label:       'Power Automate',
    description: 'Microsoft Power Platform workflow automation',
    color:       'bg-blue-50 border-blue-200',
    badge:       'bg-blue-100 text-blue-700',
    fields: [
      { key: 'tenant_id',     label: 'Tenant ID (Directory ID)', type: 'text',     placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
      { key: 'client_id',     label: 'Client ID (App Registration)', type: 'text', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', required: true },
      { key: 'client_secret', label: 'Client Secret',             type: 'password', placeholder: 'App registration client secret', required: true },
      { key: 'dataverse_url', label: 'Dataverse URL',              type: 'text',     placeholder: 'https://yourorg.crm.dynamics.com', required: true },
      { key: 'environment_id',label: 'Environment ID',            type: 'text',     placeholder: 'Optional — for reference only', required: false },
    ],
    warning: 'The app registration must be added as an Application User (with a security role) in the target environment — see environment Settings → Users + permissions → Application users in the Power Platform Admin Center.',
  },
}

const STATUS_CONFIG = {
  connected:    { variant: 'success', icon: CheckCircle2, label: 'Connected' },
  error:        { variant: 'danger',  icon: XCircle,      label: 'Error' },
  unconfigured: { variant: 'default', icon: AlertCircle,  label: 'Not tested' },
}

// ── Config form ────────────────────────────────────────────────────────────
// isEdit: the connection list never returns api_key/client_secret (stripped
// server-side), so on edit those fields start blank and must stay optional
// — "blank" means "keep the current value", not "clear it". Save only
// includes password-type fields the admin actually typed something into,
// so PUT /:id's config_json merge can't overwrite a real key with "".
function ConfigForm({ platform, initial = {}, onSave, onCancel, isSaving, isEdit = false }) {
  const meta = PLATFORM_META[platform]
  const [form, setForm] = useState(() =>
    Object.fromEntries(meta.fields.map(f => [f.key, initial[f.key] ?? (f.type === 'select' ? f.options[0].value : '')]))
  )
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const isValid = meta.fields
    .filter(f => f.required && !(isEdit && f.type === 'password'))
    .every(f => form[f.key]?.trim())

  function handleSave() {
    const out = { ...form }
    if (isEdit) {
      for (const f of meta.fields) {
        if (f.type === 'password' && !out[f.key]?.trim()) delete out[f.key]
      }
    }
    onSave(out)
  }

  return (
    <div className="space-y-4 pt-2">
      {meta.warning && (
        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
          <AlertCircle size={13} className="shrink-0 mt-0.5" />
          {meta.warning}
        </div>
      )}
      {meta.fields.map(f => (
        <div key={f.key}>
          <Label>
            {f.label}
            {f.required && !(isEdit && f.type === 'password') && <span className="text-red-500 ml-0.5">*</span>}
          </Label>
          {f.type === 'select' ? (
            <Select value={form[f.key]} onChange={set(f.key)}>
              {f.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          ) : (
            <Input
              type={f.type}
              value={form[f.key]}
              onChange={set(f.key)}
              placeholder={isEdit && f.type === 'password' ? 'Leave blank to keep current' : f.placeholder}
              autoComplete="off"
            />
          )}
        </div>
      ))}
      <div className="flex gap-2 pt-1">
        <Button disabled={!isValid || isSaving} onClick={handleSave}>
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Zapier enforcement credential panel ────────────────────────────────────
// "Zapier -> IOA": IOA issues a revocable credential (auth.api_keys, same
// mechanism the discovery-agent CLI uses); Zapier exchanges it for a
// short-lived token and calls POST /enforce before a Zap proceeds. This is
// the reverse of "IOA -> Zapier" (OAuth 2.0 + Zapier's Workflow API, needed
// to discover/import Zaps) — that direction needs no work here yet, and
// isn't what this panel does. Chosen first because it ships without any
// Zapier-side API access at all.
function ZapierEnforcementPanel({ initialName, onDone }) {
  const qc = useQueryClient()
  const [name, setName] = useState(initialName ?? '')
  const [issued, setIssued] = useState(null)
  const [copied, setCopied] = useState(false)

  const { data: keys = [] } = useQuery({ queryKey: ['api-keys'], queryFn: apiKeysApi.list })
  const zapierKeys = keys.filter(k => k.name?.startsWith('Zapier: ') && !k.revoked_at)

  const create = useMutation({
    mutationFn: () => apiKeysApi.create({ name: `Zapier: ${name.trim()}`, scopes: ['workflow:read'] }),
    onSuccess:  key => { setIssued(key); qc.invalidateQueries({ queryKey: ['api-keys'] }) },
  })

  const revoke = useMutation({
    mutationFn: id => apiKeysApi.remove(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  })

  const enforceUrl  = `${window.location.origin}/api/governance/enforce`
  const exchangeUrl = `${window.location.origin}/api/auth/api-keys/exchange`

  return (
    <div className="space-y-4">
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 space-y-1">
        <p className="font-medium flex items-center gap-1.5"><Zap size={13} />Zapier → IOA enforcement connection</p>
        <p>
          IOA issues Zapier a credential; Zapier calls IOA's enforcement decision before a Zap
          acts and gets back allow, warn, or block. This does not import or discover your Zaps —
          that's a separate, OAuth-based connection (IOA → Zapier, using Zapier's Workflow API)
          planned as a later phase, not this one.
        </p>
      </div>

      {zapierKeys.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Existing Zapier credentials</p>
          <div className="space-y-1.5">
            {zapierKeys.map(k => (
              <div key={k.id} className="flex items-center justify-between text-xs bg-gray-50 rounded px-2 py-1.5">
                <span className="text-gray-700">
                  {k.name.replace(/^Zapier:\s*/, '')} <span className="text-gray-400 font-mono">({k.key_prefix}…)</span>
                </span>
                <button
                  onClick={() => revoke.mutate(k.id)}
                  disabled={revoke.isPending}
                  className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                  title="Revoke credential"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!issued && (
        <div className="space-y-3">
          <div>
            <Label>Connection name <span className="text-red-500">*</span></Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Production Zapier" autoFocus />
          </div>
          <div className="flex gap-2">
            <Button disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Generating…' : 'Generate IOA Credential'}
            </Button>
            <Button variant="secondary" onClick={onDone}>Cancel</Button>
          </div>
          {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
        </div>
      )}

      {issued && (
        <div className="space-y-3">
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
            <p className="font-medium mb-1.5">Save this key now — it won't be shown again.</p>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-white border border-amber-200 rounded px-2 py-1 font-mono text-[11px] break-all">
                {issued.api_key}
              </code>
              <Button
                size="sm" variant="secondary"
                onClick={() => { navigator.clipboard.writeText(issued.api_key); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              >
                <Copy size={12} />{copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>

          <div className="text-xs text-gray-600 space-y-2">
            <p className="font-medium text-gray-700">Set up in Zapier — 3 native "Webhooks by Zapier" steps, no custom app needed:</p>
            <ol className="list-decimal list-inside space-y-2">
              <li>
                <span className="font-medium text-gray-700">Exchange the key for a token.</span> POST to{' '}
                <code className="bg-gray-100 rounded px-1 py-0.5 break-all">{exchangeUrl}</code> with body{' '}
                <code className="bg-gray-100 rounded px-1 py-0.5">{'{ "api_key": "<the key above>" }'}</code>.
                Returns a token valid for 15 minutes.
              </li>
              <li>
                <span className="font-medium text-gray-700">Call the enforcement decision.</span> POST to{' '}
                <code className="bg-gray-100 rounded px-1 py-0.5 break-all">{enforceUrl}</code> with header{' '}
                <code className="bg-gray-100 rounded px-1 py-0.5">Authorization: Bearer {'{{step1 token}}'}</code> and body{' '}
                <code className="bg-gray-100 rounded px-1 py-0.5">{'{ "asset_type": "zap", "asset_id": "<your Zap name>", "context": { "triggerApp": "…", "actionApp": "…" } }'}</code>.
              </li>
              <li>
                <span className="font-medium text-gray-700">Branch on the result.</span> Add a Zapier Path on{' '}
                <code className="bg-gray-100 rounded px-1 py-0.5">{'{{step2 decision}}'}</code>: <code>allow</code> continues,{' '}
                <code>warn</code> continues (a finding is still logged), <code>block</code> stops the Zap.
              </li>
            </ol>
            <p>
              Governance mode (observe / warn / enforce) is controlled by the{' '}
              <span className="font-medium">Zapier Zap Execution Governance</span> policy under Governance → Policies,
              not by this connection — it starts in observe (record-only) until deliberately promoted.
            </p>
          </div>

          <Button size="sm" variant="secondary" onClick={onDone}>Done</Button>
        </div>
      )}
    </div>
  )
}

// ── Single connection card ─────────────────────────────────────────────────
function ConnectionCard({ conn, onTest, onDelete, onEdit, isTesting, isEditing, editSlot }) {
  const [expanded, setExpanded] = useState(false)
  const meta    = PLATFORM_META[conn.platform]
  const status  = STATUS_CONFIG[conn.status] ?? STATUS_CONFIG.unconfigured
  const Icon    = status.icon

  if (isEditing) {
    return (
      <div className={`border rounded-lg p-4 ${meta.color}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-900">{conn.name}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>
            {meta.label}
          </span>
        </div>
        {editSlot}
      </div>
    )
  }

  return (
    <div className={`border rounded-lg p-4 ${meta.color}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Plug size={16} className="shrink-0 text-gray-500" />
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-900">{conn.name}</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>
                {meta.label}
              </span>
              <span className="inline-flex items-center gap-1 text-xs">
                <Icon size={12} className={conn.status === 'connected' ? 'text-green-600' : conn.status === 'error' ? 'text-red-500' : 'text-gray-400'} />
                <span className={conn.status === 'connected' ? 'text-green-700' : conn.status === 'error' ? 'text-red-600' : 'text-gray-500'}>
                  {status.label}
                </span>
              </span>
              {conn.workflow_count > 0 && (
                <span className="text-xs text-gray-400">{conn.workflow_count} workflows</span>
              )}
            </div>
            {conn.error_message && (
              <p className="text-xs text-red-600 mt-1 truncate max-w-sm">{conn.error_message}</p>
            )}
            {conn.last_tested_at && (
              <p className="text-xs text-gray-400 mt-0.5">
                Tested {new Date(conn.last_tested_at).toLocaleString()}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Button size="sm" variant="secondary" onClick={onTest} disabled={isTesting}>
            <RefreshCw size={12} className={isTesting ? 'animate-spin' : ''} />
            {isTesting ? 'Testing…' : 'Test'}
          </Button>
          {meta.fields && (
            <button
              onClick={onEdit}
              className="p-1.5 text-gray-400 hover:text-indigo-600 transition-colors"
              title="Edit connection"
            >
              <Pencil size={14} />
            </button>
          )}
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
            title="Show config details"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
            title="Remove connection"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && Object.keys(conn.config_json ?? {}).length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200 text-xs text-gray-400 space-y-0.5">
          {Object.entries(conn.config_json).map(([k, v]) => (
            <div key={k}><span className="text-gray-500 font-medium">{k}:</span> {String(v)}</div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Add-connection panel ───────────────────────────────────────────────────
function AddConnectionPanel({ onDone }) {
  const qc = useQueryClient()
  const [step,     setStep]     = useState('pick')   // 'pick' | 'configure'
  const [platform, setPlatform] = useState(null)
  const [name,     setName]     = useState('')

  const create = useMutation({
    mutationFn: ({ platform, name, config_json }) =>
      platformsApi.create({ platform, name, config_json }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['platforms'] })
      onDone()
    },
  })

  if (step === 'pick') {
    return (
      <div className="space-y-3">
        <p className="text-sm text-gray-600">Choose a platform to connect:</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(PLATFORM_META).map(([key, meta]) => (
            <button
              key={key}
              onClick={() => { setPlatform(key); setStep('configure') }}
              className={`text-left p-4 rounded-lg border-2 transition-colors hover:border-indigo-300 ${meta.color}`}
            >
              <div className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium mb-2 ${meta.badge}`}>
                {meta.label}
              </div>
              <p className="text-xs text-gray-600">{meta.description}</p>
            </button>
          ))}
        </div>
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
      </div>
    )
  }

  const meta = PLATFORM_META[platform]

  if (meta.kind === 'enforcement') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <button onClick={() => setStep('pick')} className="text-xs text-indigo-600 hover:underline">← Back</button>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>{meta.label}</span>
        </div>
        <ZapierEnforcementPanel onDone={onDone} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={() => setStep('pick')} className="text-xs text-indigo-600 hover:underline">← Back</button>
        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${meta.badge}`}>{meta.label}</span>
      </div>
      <div>
        <Label>Connection name <span className="text-red-500">*</span></Label>
        <Input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={`e.g. Production ${meta.label}`}
          autoFocus
        />
      </div>
      <ConfigForm
        platform={platform}
        onSave={config_json => create.mutate({ platform, name: name.trim(), config_json })}
        onCancel={onDone}
        isSaving={create.isPending}
      />
      {create.error && (
        <p className="text-xs text-red-600">{create.error.message}</p>
      )}
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export function Integrations() {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [showAdd, setShowAdd] = useState(false)
  const [testingId, setTestingId] = useState(null)
  const [editingId, setEditingId] = useState(null)

  const update = useMutation({
    mutationFn: ({ id, config_json }) => platformsApi.update(id, { config_json }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['platforms'] }); setEditingId(null) },
  })

  const { data: connections = [], isLoading } = useQuery({
    queryKey: ['platforms'],
    queryFn:  platformsApi.list,
  })

  const remove = useMutation({
    mutationFn: platformsApi.remove,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['platforms'] }),
  })

  const test = useMutation({
    mutationFn: platformsApi.test,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['platforms'] }),
    onSettled:  () => setTestingId(null),
  })

  function handleTest(id) {
    setTestingId(id)
    test.mutate(id)
  }

  async function handleDelete(conn) {
    const ok = await confirm({
      title:        'Remove Connection',
      message:      `Remove "${conn.name}"? Workflows imported from this connection will remain but lose their platform link.`,
      confirmLabel: 'Remove',
    })
    if (ok) remove.mutate(conn.id)
  }

  const connected = connections.filter(c => c.status === 'connected').length

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Integrations</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Connect workflow platforms to import and govern their automations.
            {connected > 0 && <span className="ml-1 text-green-700 font-medium">{connected} active connection{connected !== 1 ? 's' : ''}.</span>}
          </p>
        </div>
        {!showAdd && (
          <Button onClick={() => setShowAdd(true)}>
            <Plus size={15} />Add Connection
          </Button>
        )}
      </div>

      {/* Add panel */}
      {showAdd && (
        <Card>
          <div className="p-5">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">New Platform Connection</h3>
            <AddConnectionPanel onDone={() => setShowAdd(false)} />
          </div>
        </Card>
      )}

      {/* Connection list */}
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && connections.length === 0 && !showAdd && (
        <Card>
          <div className="py-16 text-center space-y-3">
            <Plug size={32} className="mx-auto text-gray-300" />
            <p className="text-sm text-gray-500">No platform connections yet.</p>
            <p className="text-xs text-gray-400">Add your first connection to start importing workflows.</p>
          </div>
        </Card>
      )}

      {connections.length > 0 && (
        <div className="space-y-3">
          {connections.map(conn => (
            <ConnectionCard
              key={conn.id}
              conn={conn}
              isTesting={testingId === conn.id}
              isEditing={editingId === conn.id}
              onTest={() => handleTest(conn.id)}
              onDelete={() => handleDelete(conn)}
              onEdit={() => setEditingId(conn.id)}
              editSlot={
                <>
                  <ConfigForm
                    platform={conn.platform}
                    initial={conn.config_json}
                    isEdit
                    onSave={config_json => update.mutate({ id: conn.id, config_json })}
                    onCancel={() => setEditingId(null)}
                    isSaving={update.isPending}
                  />
                  {update.error && <p className="text-xs text-red-600 mt-2">{update.error.message}</p>}
                </>
              }
            />
          ))}
        </div>
      )}

      {/* Platform capability guide */}
      <Card>
        <div className="p-5">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Platform governance data quality</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-400 uppercase text-left border-b border-gray-100">
                  <th className="pb-2 pr-4">Platform</th>
                  <th className="pb-2 pr-4">Step configs</th>
                  <th className="pb-2 pr-4">PII detection</th>
                  <th className="pb-2 pr-4">Folder structure</th>
                  <th className="pb-2">Auth</th>
                </tr>
              </thead>
              <tbody className="space-y-1">
                {[
                  { p: 'n8n',            steps: '✓ Full',    pii: '✓ Field-level', folders: '✓ Projects', auth: 'API key' },
                  { p: 'make',           steps: '✓ Full',    pii: '✓ Field-level', folders: '✓ Teams / Folders', auth: 'API key' },
                  { p: 'power_automate', steps: '✓ Full',    pii: '✓ Field-level', folders: '✓ Environments', auth: 'Azure OAuth' },
                  { p: 'zapier',         steps: 'Pending OAuth discovery', pii: 'Pending OAuth discovery', folders: 'Pending OAuth discovery', auth: 'IOA-issued key (enforcement)' },
                ].map(row => (
                  <tr key={row.p} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 pr-4">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PLATFORM_META[row.p].badge}`}>
                        {PLATFORM_META[row.p].label}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{row.steps}</td>
                    <td className="py-2 pr-4 text-gray-600">{row.pii}</td>
                    <td className="py-2 pr-4 text-gray-600">{row.folders}</td>
                    <td className="py-2 text-gray-600">{row.auth}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            Zapier's step/PII/folder columns read "pending" rather than "unavailable" — it's a
            discovery capability IOA hasn't built yet (needs Zapier's OAuth 2.0 Workflow API),
            not a ceiling in Zapier's own platform. The enforcement connection above works today
            without it.
          </p>
        </div>
      </Card>

      {dialog}
    </div>
  )
}
