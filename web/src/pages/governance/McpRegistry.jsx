import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Server, Plus, ShieldQuestion } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input, Select, Label } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { mcp, governance } from '../../lib/api'
import { useAuth } from '../../components/AuthGuard'

const STATUS_VARIANT = { discovered: 'info', pending_review: 'warning', approved: 'success', rejected: 'danger', retired: 'default' }
const STATUSES = ['pending_review', 'approved', 'rejected', 'retired']

// EP-306-S13 — field-level diff between the current discovery_metadata_json
// and the most recent prior snapshot, for the Discovered tab's "what
// changed since last scan" view. No library needed for a 5-key flat object.
function diffDiscoveryMetadata(current, previous) {
  if (!current || !previous) return []
  const fields = new Set([...Object.keys(current), ...Object.keys(previous)])
  const changes = []
  for (const field of fields) {
    const from = JSON.stringify(previous[field] ?? null)
    const to = JSON.stringify(current[field] ?? null)
    if (from !== to) changes.push({ field, from: previous[field], to: current[field] })
  }
  return changes
}
const TRANSPORTS = ['local', 'remote']
const ENVIRONMENTS = ['development', 'test', 'production']

// Epic 6, Features 6.3/6.4 — MCP Assurance Evidence
const EVIDENCE_TYPES = ['config_export', 'credential_rotation_verified', 'authorization_revocation_tested', 'redeployment_recovery_tested']
const EVIDENCE_STATUS_VARIANT = { collected: 'warning', validated: 'success', rejected: 'danger', expired: 'danger', superseded: 'default' }

function AssuranceEvidenceSection({ serverId, evidence = [], onChanged }) {
  const [evidenceType, setEvidenceType] = useState(EVIDENCE_TYPES[0])
  const [expiresAt, setExpiresAt] = useState('')

  const submit = useMutation({
    mutationFn: () => mcp.submitAssuranceEvidence(serverId, { evidence_type: evidenceType, expires_at: expiresAt || null }),
    onSuccess: onChanged,
  })
  const setStatus = useMutation({
    mutationFn: ({ id, status, rejection_reason }) => mcp.setAssuranceEvidenceStatus(id, { status, rejection_reason }),
    onSuccess: onChanged,
  })

  return (
    <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-2">
      <p className="font-semibold text-gray-600">Assurance Evidence ({evidence.length})</p>
      {evidence.length === 0 && <p className="text-gray-400">None submitted yet</p>}
      {evidence.map(e => (
        <div key={e.id} className="flex items-center justify-between py-1 border-b border-gray-100 last:border-0">
          <div>
            <span className="font-medium text-gray-800">{e.evidence_type}</span>
            {e.expires_at && <span className="text-gray-400 ml-1.5">expires {new Date(e.expires_at).toLocaleDateString()}</span>}
            {e.rejection_reason && <span className="text-red-500 ml-1.5">— {e.rejection_reason}</span>}
          </div>
          <div className="flex items-center gap-1.5">
            <Badge variant={EVIDENCE_STATUS_VARIANT[e.status] ?? 'default'}>{e.status}</Badge>
            {e.status === 'collected' && (
              <>
                <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5"
                  onClick={() => setStatus.mutate({ id: e.id, status: 'validated' })}>Validate</Button>
                <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5"
                  onClick={() => {
                    const reason = window.prompt(`Reason for rejecting this ${e.evidence_type} evidence?`)
                    if (reason) setStatus.mutate({ id: e.id, status: 'rejected', rejection_reason: reason })
                  }}>Reject</Button>
              </>
            )}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-lg p-2">
        <Select value={evidenceType} onChange={e => setEvidenceType(e.target.value)} className="w-56 text-xs">
          {EVIDENCE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </Select>
        <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} className="text-xs" />
        <Button size="sm" onClick={() => submit.mutate()} disabled={submit.isPending}>
          <Plus size={12} /> Submit Evidence
        </Button>
      </div>
    </div>
  )
}

function RegisterServerModal({ onClose, onRegistered }) {
  const [name, setName] = useState('')
  const [transport, setTransport] = useState('remote')
  const [publisher, setPublisher] = useState('')
  const [hostingEnvironment, setHostingEnvironment] = useState('development')
  const [technicalOwner, setTechnicalOwner] = useState('')

  const register = useMutation({
    mutationFn: () => mcp.registerServer({
      name, transport, publisher: publisher || null,
      hosting_environment: hostingEnvironment, technical_owner: technicalOwner || null,
    }),
    onSuccess: onRegistered,
  })

  return (
    <Modal title="Register MCP Server" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500">
          Registering does not approve a server for production use — it starts as <Badge variant="warning">pending_review</Badge>.
          An unregistered server referenced elsewhere is treated as unassessed, not low-risk.
        </p>
        <div>
          <Label>Server name</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. filesystem-mcp" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Transport</Label>
            <Select value={transport} onChange={e => setTransport(e.target.value)}>
              {TRANSPORTS.map(t => <option key={t} value={t}>{t}</option>)}
            </Select>
          </div>
          <div>
            <Label>Hosting environment</Label>
            <Select value={hostingEnvironment} onChange={e => setHostingEnvironment(e.target.value)}>
              {ENVIRONMENTS.map(e => <option key={e} value={e}>{e}</option>)}
            </Select>
          </div>
        </div>
        <div>
          <Label>Publisher / source</Label>
          <Input value={publisher} onChange={e => setPublisher(e.target.value)} placeholder="e.g. @modelcontextprotocol/server-filesystem" />
        </div>
        <div>
          <Label>Technical owner</Label>
          <Input value={technicalOwner} onChange={e => setTechnicalOwner(e.target.value)} placeholder="owner@company.com" />
        </div>
        <div className="flex gap-2 pt-2">
          <Button onClick={() => register.mutate()} disabled={!name || register.isPending}>Register</Button>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}

const CLASSIFICATIONS = ['T0', 'T1', 'T2', 'T3', 'T4']
const CLASSIFICATION_HINT = {
  T0: 'Public, read-only — log & allow',
  T1: 'Internal read-only — identity, scope & audit',
  T2: 'Reversible write — confirmation or policy approval',
  T3: 'Sensitive/consequential — human approval required',
  T4: 'Privileged/destructive — prohibit or break-glass only',
}

function AddToolForm({ serverId, onAdded }) {
  const [name, setName] = useState('')
  const [behavior, setBehavior] = useState('read')
  const [classification, setClassification] = useState('T0')
  const [destructive, setDestructive] = useState(false)

  const add = useMutation({
    mutationFn: () => mcp.addTool(serverId, { name, behavior, classification, destructive }),
    onSuccess: () => { setName(''); onAdded() },
  })

  return (
    <div className="flex flex-wrap items-end gap-2 bg-white border border-gray-200 rounded-lg p-2">
      <Input placeholder="tool name" value={name} onChange={e => setName(e.target.value)} className="w-32 text-xs" />
      <Select value={behavior} onChange={e => setBehavior(e.target.value)} className="w-24 text-xs">
        <option value="read">read</option>
        <option value="write">write</option>
      </Select>
      <Select value={classification} onChange={e => setClassification(e.target.value)} className="w-16 text-xs" title={CLASSIFICATION_HINT[classification]}>
        {CLASSIFICATIONS.map(c => <option key={c} value={c}>{c}</option>)}
      </Select>
      <label className="flex items-center gap-1 text-xs text-gray-500">
        <input type="checkbox" checked={destructive} onChange={e => setDestructive(e.target.checked)} />
        destructive
      </label>
      <Button size="sm" onClick={() => add.mutate()} disabled={!name || add.isPending}>
        <Plus size={12} /> Add
      </Button>
    </div>
  )
}

// Epic 3, Features 3.1/3.2/3.3 — on-demand decision + definition history for
// a single tool. Fetched only when expanded, not eagerly per row.
function ToolHistoryPanel({ toolId }) {
  const { data: decisions = [] } = useQuery({
    queryKey: ['mcp-tool-decision-history', toolId],
    queryFn: () => mcp.getToolDecisionHistory(toolId),
  })
  const { data: definitions = [] } = useQuery({
    queryKey: ['mcp-tool-definition-history', toolId],
    queryFn: () => mcp.getToolDefinitionHistory(toolId),
  })

  if (decisions.length === 0 && definitions.length === 0) {
    return <p className="text-gray-400 py-1">No history recorded yet.</p>
  }

  return (
    <div className="space-y-1.5 py-1.5">
      {decisions.map(d => (
        <div key={d.id} className="text-gray-500">
          <span className="text-gray-700">{d.decision_type}: {d.from_value ?? '(none)'} → {d.to_value}</span>
          {d.reason && <span className="text-gray-400"> — {d.reason}</span>}
          <span className="text-gray-400 ml-1.5">({new Date(d.changed_at).toLocaleString()})</span>
        </div>
      ))}
      {definitions.map(v => (
        <div key={v.id} className="text-gray-500">
          <span className="text-gray-700">definition superseded</span>
          <span className="text-gray-400"> — previous description: "{v.description ?? '(none)'}"</span>
          <span className="text-gray-400 ml-1.5">({new Date(v.superseded_at).toLocaleString()})</span>
        </div>
      ))}
    </div>
  )
}

// EP-103-S7 — unified status + decision history: merges this server's own
// status_history (approve/reject/retire) with the platform-wide
// approval_decision_history for the server AND every one of its tools/prompts
// (tool approvals/denials/classification changes, prompt approvals) into one
// chronological timeline. Complements — doesn't replace — the per-tool
// ToolHistoryPanel drill-down below, which stays the detailed view for one tool.
function ServerUnifiedHistory({ server }) {
  const assetIds = [server.id, ...(server.tools ?? []).map(t => t.id), ...(server.prompts ?? []).map(p => p.id)]
  const { data: decisions = [], isLoading } = useQuery({
    queryKey: ['approval-decisions', assetIds],
    queryFn: () => governance.approvalDecisionsByIds(assetIds),
  })

  const toolNameById = Object.fromEntries((server.tools ?? []).map(t => [t.id, t.name]))
  const promptNameById = Object.fromEntries((server.prompts ?? []).map(p => [p.id, p.name]))
  function assetLabel(d) {
    if (d.asset_type === 'mcp_server') return server.name
    if (d.asset_type === 'mcp_tool') return toolNameById[d.asset_id] ?? d.asset_id
    if (d.asset_type === 'mcp_prompt') return promptNameById[d.asset_id] ?? d.asset_id
    return d.asset_id
  }

  const events = [
    ...(server.status_history ?? []).map(h => ({
      id: `status:${h.id}`, time: h.changed_at, kind: 'status',
      text: `${server.name}: ${h.from_status ?? 'registered'} → ${h.to_status}`, reason: h.reason,
    })),
    ...decisions.map(d => ({
      id: `decision:${d.id}`, time: d.decided_at, kind: d.asset_type,
      text: `${assetLabel(d)} (${d.asset_type.replace('mcp_', '')}): ${d.decision} by ${d.actor}`, reason: d.supporting_evidence,
    })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time))

  if (isLoading) return <p className="text-xs text-gray-400">Loading history…</p>
  if (events.length === 0) return null

  return (
    <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1">
      <p className="font-semibold text-gray-600 mb-1">Unified History ({events.length})</p>
      {events.map(e => (
        <div key={e.id} className="text-gray-500">
          <span className="text-gray-700">{e.text}</span>
          {e.reason && <span className="text-gray-400"> — {e.reason}</span>}
          <span className="text-gray-400 ml-1.5">({new Date(e.time).toLocaleString()})</span>
        </div>
      ))}
    </div>
  )
}

function ServerDetailModal({ serverId, onClose }) {
  const qc = useQueryClient()
  const { user, hasPermission } = useAuth()
  const canApprove = hasPermission('mcp:approve')
  const [expandedToolId, setExpandedToolId] = useState(null)
  const { data: server, isLoading } = useQuery({
    queryKey: ['mcp-server', serverId],
    queryFn: () => mcp.getServer(serverId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['mcp-server', serverId] })

  // EP-202 — approving a server whose risk_tier has an active approval
  // chain doesn't finalize here: the API returns 202 { chain_started: true,
  // request } instead of the updated server, and the server's status stays
  // whatever it already was until that chain completes (see
  // Admin → Approval Chains for tracking/deciding it).
  const setStatus = useMutation({
    mutationFn: ({ status, reason }) => mcp.setServerStatus(serverId, { status, reason }),
    onSuccess: (data) => {
      if (data?.chain_started) {
        window.alert(`This server's risk tier requires multi-stage approval — a "${data.request.chain_name}" chain has been started. Track it under Administration → Approval Chains.`)
      }
      invalidate()
      qc.invalidateQueries({ queryKey: ['mcp-servers'] })
    },
  })

  // EP-101-S8/S9 — claims a credential-exposure finding has been rotated.
  // The finding stays visible until the next scan either drops it (rotated)
  // or reinserts it carrying this same confirmation forward (still exposed).
  const confirmRotation = useMutation({
    mutationFn: (id) => mcp.confirmCredentialRotation(id, user?.username ?? 'unknown'),
    onSuccess: invalidate,
  })

  const setToolApproval = useMutation({
    mutationFn: ({ id, approval_status, reason }) => mcp.setToolApproval(id, approval_status, reason),
    onSuccess: invalidate,
  })

  const { data: serverViolations = [], refetch: refetchViolations } = useQuery({
    queryKey: ['mcp-server-violations', serverId],
    queryFn: () => governance.listViolations({ entity_type: 'mcp_server', entity_id: serverId }),
  })

  // Epic 4, Feature 4.5 — policies bound directly to this server (not
  // through any workflow) only take effect once evaluated.
  const evaluatePolicies = useMutation({
    mutationFn: () => governance.evaluateMcpServer(serverId),
    onSuccess: refetchViolations,
  })

  return (
    <Modal title={server?.name ?? 'MCP Server'} onClose={onClose}>
      {isLoading ? <p className="text-sm text-gray-400 py-4">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={STATUS_VARIANT[server.status] ?? 'default'}>{server.status}</Badge>
            <Badge variant="default">{server.transport}</Badge>
            {server.hosting_environment && <Badge variant="default">{server.hosting_environment}</Badge>}
            {server.trusted_publisher && <Badge variant="success">trusted publisher</Badge>}
          </div>

          {server.status === 'discovered' ? (
            <>
              {/* EP-306-S5 — a discovered stub has none of the registry's own
                  fields filled in yet (no owner/risk_tier — those only get
                  set once a human actually registers it), so the normal
                  detail grid would render as a wall of "—". Show what the
                  scan actually found instead. */}
              <div className="bg-blue-50 rounded-lg p-3 text-xs space-y-1.5">
                <p className="font-semibold text-blue-700">Discovery details</p>
                <div><span className="text-gray-400">Source</span> <span className="text-gray-700">{server.discovery_metadata_json?.source ?? '—'}</span></div>
                <div><span className="text-gray-400">Found at</span> <span className="text-gray-700 break-all">{server.discovery_metadata_json?.source_path ?? '—'}</span></div>
                {server.discovery_metadata_json?.command && (
                  <div><span className="text-gray-400">Command</span> <span className="text-gray-700 font-mono">{server.discovery_metadata_json.command} {(server.discovery_metadata_json.args ?? []).join(' ')}</span></div>
                )}
                {server.endpoint && (
                  <div><span className="text-gray-400">URL</span> <span className="text-gray-700 font-mono break-all">{server.endpoint}</span></div>
                )}
                {server.discovery_metadata_json?.env_hints?.length > 0 && (
                  <div><span className="text-gray-400">Env vars referenced</span> <span className="text-gray-700 font-mono">{server.discovery_metadata_json.env_hints.join(', ')}</span></div>
                )}
                <div><span className="text-gray-400">Last seen</span> <span className="text-gray-700">{server.last_discovery_at ? new Date(server.last_discovery_at).toLocaleString() : '—'}</span></div>
              </div>

              {(() => {
                const lastScan = server.discovery_history?.[0]
                const changes = diffDiscoveryMetadata(server.discovery_metadata_json, lastScan?.metadata_json)
                if (!lastScan || changes.length === 0) return null
                return (
                  <div className="bg-amber-50 rounded-lg p-3 text-xs space-y-1">
                    <p className="font-semibold text-amber-700">
                      Changed since last scan ({new Date(lastScan.recorded_at).toLocaleString()})
                    </p>
                    {changes.map(c => (
                      <div key={c.field}>
                        <span className="text-gray-500">{c.field}:</span>{' '}
                        <span className="text-red-600 line-through">{JSON.stringify(c.from)}</span>
                        {' → '}
                        <span className="text-green-700">{JSON.stringify(c.to)}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {canApprove && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => setStatus.mutate({ status: 'pending_review', reason: 'Promoted from discovery queue' })}>
                    Promote to Review
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => {
                    const reason = window.prompt(`Reason for dismissing "${server.name}"?`)
                    if (reason) setStatus.mutate({ status: 'rejected', reason: `Dismissed from discovery queue: ${reason}` })
                  }}>Dismiss</Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                <div><span className="text-gray-400">Publisher</span> <span className="text-gray-700">{server.publisher ?? '—'}</span></div>
                <div><span className="text-gray-400">Technical owner</span> <span className="text-gray-700">{server.technical_owner ?? '—'}</span></div>
                <div><span className="text-gray-400">Business owner</span> <span className="text-gray-700">{server.business_owner ?? '—'}</span></div>
                <div><span className="text-gray-400">Risk tier</span> <span className="text-gray-700">{server.risk_tier ?? '—'}</span></div>
              </div>

              {canApprove && (
                <div className="flex gap-2">
                  {server.status !== 'approved' && (
                    <Button size="sm" onClick={() => setStatus.mutate({ status: 'approved' })}>Approve</Button>
                  )}
                  {server.status !== 'rejected' && (
                    <Button size="sm" variant="danger" onClick={() => {
                      const reason = window.prompt(`Reason for rejecting "${server.name}"?`)
                      if (reason) setStatus.mutate({ status: 'rejected', reason })
                    }}>Reject</Button>
                  )}
                  {server.status !== 'retired' && (
                    <Button size="sm" variant="secondary" onClick={() => setStatus.mutate({ status: 'retired' })}>Retire</Button>
                  )}
                </div>
              )}
            </>
          )}

          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-semibold text-gray-600">
                Policy Violations ({serverViolations.filter(v => v.status === 'open').length} open)
              </p>
              <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5"
                onClick={() => evaluatePolicies.mutate()} disabled={evaluatePolicies.isPending}>
                {evaluatePolicies.isPending ? 'Evaluating…' : 'Evaluate Policies'}
              </Button>
            </div>
            {serverViolations.length === 0 && <p className="text-gray-400">No policies bound directly to this server have been evaluated yet.</p>}
            {serverViolations.map(v => (
              <div key={v.id} className="text-gray-500">
                <Badge variant={v.severity === 'critical' ? 'danger' : v.severity === 'high' ? 'warning' : 'default'}>{v.severity}</Badge>
                <span className="ml-1.5 text-gray-400">[{v.status}]</span>
                <span className="ml-1.5">{v.message}</span>
              </div>
            ))}
          </div>

          <ServerUnifiedHistory server={server} />

          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-2">
            <p className="font-semibold text-gray-600">Tools ({server.tools?.length ?? 0}) — deny-by-default; new tools start pending</p>
            {server.tools?.length === 0 && <p className="text-gray-400">None registered</p>}
            {server.tools?.map(t => (
              <div key={t.id} className="border-b border-gray-100 last:border-0">
                <div className="flex items-center justify-between py-1">
                  <div>
                    <span className="font-medium text-gray-800">{t.name}</span>
                    <span className="text-gray-400 ml-1.5">{t.behavior}{t.destructive ? ' · destructive' : ''}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Badge variant={t.classification === 'T4' || t.classification === 'T3' ? 'danger' : t.classification === 'T2' ? 'warning' : 'default'}>
                      {t.classification ?? '?'}
                    </Badge>
                    <Badge variant={t.approval_status === 'allowed' ? 'success' : t.approval_status === 'denied' ? 'danger' : 'warning'}>
                      {t.approval_status}
                    </Badge>
                    {t.approval_status !== 'allowed' && (
                      <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5"
                        onClick={() => setToolApproval.mutate({ id: t.id, approval_status: 'allowed' })}>Allow</Button>
                    )}
                    {t.approval_status !== 'denied' && (
                      <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5"
                        onClick={() => {
                          const reason = window.prompt(`Reason for denying "${t.name}"?`)
                          if (reason) setToolApproval.mutate({ id: t.id, approval_status: 'denied', reason })
                        }}>Deny</Button>
                    )}
                    <button type="button" className="text-gray-400 hover:text-gray-600 text-xs underline"
                      onClick={() => setExpandedToolId(expandedToolId === t.id ? null : t.id)}>
                      {expandedToolId === t.id ? 'hide history' : 'history'}
                    </button>
                  </div>
                </div>
                {expandedToolId === t.id && <ToolHistoryPanel toolId={t.id} />}
              </div>
            ))}
            <AddToolForm serverId={serverId} onAdded={invalidate} />
          </div>

          <div className="bg-gray-50 rounded-lg p-3 text-xs">
            <p className="font-semibold text-gray-600 mb-1">Resources ({server.resources?.length ?? 0}) / Prompts ({server.prompts?.length ?? 0})</p>
            <p className="text-gray-400">Authorizations: {server.authorizations?.length ?? 0}</p>
          </div>

          {server.credential_exposure?.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs space-y-1.5">
              <p className="font-semibold text-red-700">
                Confirmed Credential Exposure ({server.credential_exposure.length}) — critical
              </p>
              {server.credential_exposure.map(c => (
                <div key={c.id} className="flex items-center justify-between gap-2 text-red-700">
                  <div>
                    <span className="font-medium">{c.secret_type}</span>
                    <span className="text-red-500"> in {c.source_type === 'resource_uri' ? 'resource URI template' : `field "${c.field_name}"`}</span>
                    <span className="text-red-400 ml-1.5">({c.redacted_preview})</span>
                    {c.rotation_confirmed_at && (
                      <div className="text-red-500 mt-0.5">
                        Rotation claimed by {c.rotation_confirmed_by} on {new Date(c.rotation_confirmed_at).toLocaleDateString()} — still detected, claim did not hold
                      </div>
                    )}
                  </div>
                  {!c.rotation_confirmed_at && (
                    <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5 shrink-0"
                      onClick={() => confirmRotation.mutate(c.id)}>Mark Rotated</Button>
                  )}
                </div>
              ))}
              <p className="text-red-500">Rotate the exposed credential immediately — it has already been redacted from storage above.</p>
            </div>
          )}

          <AssuranceEvidenceSection serverId={serverId} evidence={server.assurance_evidence} onChanged={invalidate} />
        </div>
      )}
    </Modal>
  )
}

// EP-306-S5 — the primary interaction surface for the discovery workflow:
// review what discovery-agent found, promote a real one into the normal
// pending_review flow, or dismiss a false positive. Reuses the same
// setServerStatus/PATCH endpoint the registry tab's Approve/Reject buttons
// already call — 'discovered' is just another status it accepts.
function DiscoveryQueueSection({ onSelect }) {
  const { hasPermission } = useAuth()
  const canApprove = hasPermission('mcp:approve')
  const qc = useQueryClient()

  const { data: servers = [], isLoading } = useQuery({
    queryKey: ['mcp-servers', 'discovered'],
    queryFn: () => mcp.listServers('discovered'),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status, reason }) => mcp.setServerStatus(id, { status, reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mcp-servers'] }),
  })

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Name</th>
              <th className="px-6 py-3 font-medium">Source</th>
              <th className="px-6 py-3 font-medium">Command / URL</th>
              <th className="px-6 py-3 font-medium">Last seen</th>
              <th className="px-6 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">Loading…</td></tr>}
            {!isLoading && servers.length === 0 && (
              <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                <ShieldQuestion size={22} className="mx-auto mb-2 text-gray-300" />
                Nothing discovered yet — run the discovery-agent CLI to scan for MCP servers
              </td></tr>
            )}
            {servers.map(s => (
              <tr key={s.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-6 py-3 font-medium text-gray-800 cursor-pointer" onClick={() => onSelect(s.id)}>{s.name}</td>
                <td className="px-6 py-3 text-gray-500">{s.discovery_metadata_json?.source ?? '—'}</td>
                <td className="px-6 py-3 text-gray-500 font-mono text-xs truncate max-w-xs">
                  {s.discovery_metadata_json?.command ?? s.endpoint ?? '—'}
                </td>
                <td className="px-6 py-3 text-gray-500">{s.last_discovery_at ? new Date(s.last_discovery_at).toLocaleDateString() : '—'}</td>
                <td className="px-6 py-3">
                  {canApprove && (
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setStatus.mutate({ id: s.id, status: 'pending_review', reason: 'Promoted from discovery queue' })}>
                        Promote
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => {
                        const reason = window.prompt(`Reason for dismissing "${s.name}"?`)
                        if (reason) setStatus.mutate({ id: s.id, status: 'rejected', reason: `Dismissed from discovery queue: ${reason}` })
                      }}>Dismiss</Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export function McpRegistry() {
  const [tab, setTab] = useState('registry') // 'registry' | 'discovered'
  const [statusFilter, setStatusFilter] = useState('')
  const [showRegister, setShowRegister] = useState(false)
  // Epic 2, Feature 2.3 — deep-linkable via ?server=<id> so a workflow's MCP
  // reference can click straight through to the registry record.
  const [searchParams, setSearchParams] = useSearchParams()
  const [selectedId, setSelectedId] = useState(searchParams.get('server'))
  const qc = useQueryClient()

  function selectServer(id) {
    setSelectedId(id)
    setSearchParams(id ? { server: id } : {}, { replace: true })
  }

  const { data: allServers = [], isLoading } = useQuery({
    queryKey: ['mcp-servers', statusFilter],
    queryFn: () => mcp.listServers(statusFilter || undefined),
  })
  // EP-306-S5 — discovered candidates live in their own tab now, not mixed
  // into the registry table: a bare discovery stub has no owner/risk_tier
  // yet, and showing normal Approve/Reject/Retire buttons on it would let
  // someone skip the pending_review step entirely.
  const servers = allServers.filter(s => s.status !== 'discovered')

  // Query-cache-only — just for the tab badge count, no separate fetch
  // (React Query dedupes against DiscoveryQueueSection's identical key).
  const { data: discoveredServers = [] } = useQuery({
    queryKey: ['mcp-servers', 'discovered'],
    queryFn: () => mcp.listServers('discovered'),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Server size={22} className="text-indigo-500" />
            MCP Registry
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Authoritative registry of MCP servers. Register manually, or review what discovery-agent finds in the Discovered tab.
          </p>
        </div>
        <Button onClick={() => setShowRegister(true)}><Plus size={14} /> Register Server</Button>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'registry' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setTab('registry')}
        >
          Registry
        </button>
        <button
          className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${tab === 'discovered' ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setTab('discovered')}
        >
          Discovered
          {discoveredServers.length > 0 && <Badge variant="info">{discoveredServers.length}</Badge>}
        </button>
      </div>

      {tab === 'discovered' ? (
        <DiscoveryQueueSection onSelect={selectServer} />
      ) : (
        <>
          <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="max-w-xs">
            <option value="">All statuses</option>
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium">Transport</th>
                    <th className="px-6 py-3 font-medium">Environment</th>
                    <th className="px-6 py-3 font-medium">Owner</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-400">Loading…</td></tr>}
                  {!isLoading && servers.length === 0 && (
                    <tr><td colSpan={5} className="px-6 py-10 text-center text-gray-400">
                      <ShieldQuestion size={22} className="mx-auto mb-2 text-gray-300" />
                      No MCP servers registered yet
                    </td></tr>
                  )}
                  {servers.map(s => (
                    <tr key={s.id} className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50"
                      onClick={() => selectServer(s.id)}>
                      <td className="px-6 py-3 font-medium text-gray-800">{s.name}</td>
                      <td className="px-6 py-3 text-gray-500">{s.transport}</td>
                      <td className="px-6 py-3 text-gray-500">{s.hosting_environment ?? '—'}</td>
                      <td className="px-6 py-3 text-gray-500">{s.technical_owner ?? '—'}</td>
                      <td className="px-6 py-3"><Badge variant={STATUS_VARIANT[s.status] ?? 'default'}>{s.status}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {showRegister && (
        <RegisterServerModal
          onClose={() => setShowRegister(false)}
          onRegistered={() => { setShowRegister(false); qc.invalidateQueries({ queryKey: ['mcp-servers'] }) }}
        />
      )}
      {selectedId && <ServerDetailModal serverId={selectedId} onClose={() => selectServer(null)} />}
    </div>
  )
}
