import { useState, useEffect, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { RefreshCw, Play, Shield, AlertTriangle, GitBranch, Eye, Upload, CheckCircle2, XCircle, Sparkles, ChevronUp, ChevronDown, ShieldCheck, TrendingUp, Trash2, Download, ArchiveRestore } from 'lucide-react'
import { workflowGovernance, platforms as platformsApi, governance, downloadJson } from '../lib/api'
import { useTags } from '../hooks/useTags'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { Card, CardHeader, CardContent } from '../components/ui/Card'
import { Table, Th, Td, Tr } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Select, Input } from '../components/ui/Input'
import { InfoTip } from '../components/ui/InfoTip'
import { help } from '../lib/helpContent'
import { useAuth } from '../components/AuthGuard'

// ── Risk level helpers ─────────────────────────────────────────────────────
const riskVariant = { LOW: 'success', MEDIUM: 'warning', HIGH: 'danger', CRITICAL: 'purple' }
const sevVariant  = { low: 'success', medium: 'warning', high: 'danger', critical: 'purple' }

function RiskBar({ score }) {
  if (score == null) return <span className="text-xs text-gray-400">—</span>
  const pct = Math.min(100, Math.round(score))
  const color = score >= 75 ? 'bg-purple-500' : score >= 50 ? 'bg-red-400' : score >= 25 ? 'bg-yellow-400' : 'bg-green-400'
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-600 tabular-nums">{score}</span>
    </div>
  )
}

// ── Summary stat card ──────────────────────────────────────────────────────
function StatCard({ label, value, sub, icon: Icon, color = 'indigo', onClick }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600',
    green:  'bg-green-50  text-green-600',
    red:    'bg-red-50    text-red-600',
    yellow: 'bg-yellow-50 text-yellow-600',
  }
  const inner = (
    <CardContent className="flex items-center gap-4 py-5">
      <div className={`p-2.5 rounded-lg ${colors[color]}`}><Icon size={18} /></div>
      <div>
        <p className="text-2xl font-bold text-gray-900">{value ?? '—'}</p>
        <p className="text-xs text-gray-500">{label}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </CardContent>
  )
  if (onClick) {
    return (
      <button onClick={onClick} className="w-full text-left rounded-xl ring-indigo-300 hover:ring-2 transition-all focus:outline-none focus:ring-2">
        <Card>{inner}</Card>
      </button>
    )
  }
  return <Card>{inner}</Card>
}

// ── Policy type display config ─────────────────────────────────────────────
const POLICY_DISPLAY = {
  guardrail:         { label: 'Operational Guardrails', color: 'bg-indigo-50 border-indigo-200 text-indigo-700', badge: 'bg-indigo-100 text-indigo-700' },
  mandatory_control: { label: 'Mandatory Controls',     color: 'bg-red-50 border-red-200 text-red-700',         badge: 'bg-red-100 text-red-700' },
  ai_governance:     { label: 'AI Safety Controls',     color: 'bg-purple-50 border-purple-200 text-purple-700', badge: 'bg-purple-100 text-purple-700' },
}
const FRAMEWORK_BADGE = {
  HIPAA:          'bg-orange-100 text-orange-700',
  GDPR:           'bg-blue-100 text-blue-700',
  AI_GOVERNANCE:  'bg-purple-100 text-purple-700',
}
const ACTION_LABEL = { block: 'Block', require: 'Required', alert: 'Alert', log: 'Log' }
const RISK_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 }

const GOV_TYPE_VARIANT = {
  ai_inference: 'purple', http: 'info', database: 'warning',
  approval: 'success', credential: 'danger', webhook: 'info',
  schedule: 'default', notification: 'default', storage: 'default',
  transform: 'default', logic: 'default', unknown: 'default',
}

function PolicyCard({ policy }) {
  const display = POLICY_DISPLAY[policy.policy_type] ?? POLICY_DISPLAY.guardrail
  const inf = policy.inferred_from ?? {}

  const triggerSentence = policy.policy_type === 'guardrail'
    ? `Auto-applied · ${inf.risk_level ?? ''} risk · score ${inf.risk_score ?? '?'}`
    : policy.policy_type === 'ai_governance'
    ? `AI inference detected · provider risk score ${inf.ai_score ?? '?'}`
    : policy.compliance_framework === 'GDPR'
    ? `PII exposure detected · PII score ${inf.pii_score ?? '?'}`
    : `Risk score ${inf.risk_score ?? '?'} exceeded threshold`

  return (
    <div className={`border rounded-lg p-3 ${display.color}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold uppercase tracking-wide">{display.label}</span>
        <div className="flex items-center gap-1.5">
          {policy.compliance_framework && (
            <span className={`px-1.5 py-0 text-xs font-medium rounded ${FRAMEWORK_BADGE[policy.compliance_framework] ?? 'bg-gray-100 text-gray-600'}`}>
              {policy.compliance_framework}
            </span>
          )}
          <span className={`px-1.5 py-0 text-xs rounded ${display.badge}`}>AUTO</span>
        </div>
      </div>
      <p className="text-xs opacity-80 mb-2">{triggerSentence}</p>
      <ul className="space-y-1">
        {policy.rules.map(rule => (
          <li key={rule.id} className="flex items-start gap-2 text-xs">
            <span className="shrink-0 font-medium opacity-60 w-14 text-right">
              {ACTION_LABEL[rule.action?.type] ?? rule.action?.type}
            </span>
            <span className="font-medium">{rule.name}</span>
            {rule.condition?.value != null && (
              <span className="opacity-60">
                {rule.condition.operator} {rule.condition.value.toLocaleString()}
                {rule.condition.dimension === 'execution_duration_ms' ? ' ms' : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Ownership & business classification panel ──────────────────────────────
// technical_owner/business_owner are inline-editable (marks ownership_source
// = 'manual', so tag-driven sync no longer overwrites them). Everything else
// here is classification-only, tag-driven, and shown read-only.
function OwnershipPanel({ wf, workflowId }) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [technicalOwner, setTechnicalOwner] = useState(wf.technical_owner ?? '')
  const [businessOwner,  setBusinessOwner]  = useState(wf.business_owner ?? '')

  const save = useMutation({
    mutationFn: () => workflowGovernance.updateOwnership(workflowId, {
      technical_owner: technicalOwner || null,
      business_owner:  businessOwner || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow', workflowId] })
      setEditing(false)
    },
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Ownership & Classification</h3>
        {!editing && (
          <button onClick={() => setEditing(true)} className="text-xs text-indigo-500 hover:text-indigo-700">Edit</button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2 bg-gray-50 border border-gray-200 rounded-lg p-3">
          <Input placeholder="Technical owner" value={technicalOwner} onChange={e => setTechnicalOwner(e.target.value)} />
          <Input placeholder="Business owner"  value={businessOwner}  onChange={e => setBusinessOwner(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>Save</Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <div><span className="text-gray-400">Technical owner</span> <span className="text-gray-700">{wf.technical_owner ?? '—'}</span></div>
          <div><span className="text-gray-400">Business owner</span> <span className="text-gray-700">{wf.business_owner ?? '—'}</span></div>
          <div><span className="text-gray-400">Owning team</span> <span className="text-gray-700">{wf.owning_team ?? '—'}</span></div>
          <div><span className="text-gray-400">Escalation contact</span> <span className="text-gray-700">{wf.escalation_contact ?? '—'}</span></div>
          <div><span className="text-gray-400">Business domain</span> <span className="text-gray-700">{wf.business_domain ?? '—'}</span></div>
          <div><span className="text-gray-400">Criticality</span> <span className="text-gray-700">{wf.criticality ?? '—'}</span></div>
        </div>
      )}
      {wf.risk_breakdown_json?.dimensions?.ownership_gap?.score > 0 && (
        <p className="text-xs text-amber-600 mt-1.5">Missing/stale ownership is adding risk points — see Detected Risk Signals below.</p>
      )}
    </div>
  )
}

// ── PII type drill-down modal ──────────────────────────────────────────────
function PiiDrilldownModal({ piiType, onClose, onSelectWorkflow }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['pii-drilldown', piiType],
    queryFn:  () => workflowGovernance.riskPiiType(piiType),
  })

  const exposed  = rows.filter(r => !r.masked)
  const masked   = rows.filter(r =>  r.masked)
  const uniqueWf = [...new Map(rows.map(r => [r.id, r])).values()]

  return (
    <Modal title={`${piiType} PII Exposure`} onClose={onClose}>
      {isLoading
        ? <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
        : (
          <div className="space-y-4">
            {/* Summary chips */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-full">
                {uniqueWf.length} {uniqueWf.length === 1 ? 'workflow' : 'workflows'}
              </span>
              {exposed.length > 0 && (
                <span className="px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
                  {exposed.length} exposed
                </span>
              )}
              {masked.length > 0 && (
                <span className="px-2.5 py-1 text-xs font-medium bg-green-100 text-green-700 rounded-full">
                  {masked.length} masked
                </span>
              )}
            </div>

            {/* Workflow list */}
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              {uniqueWf.map(wf => {
                const wfRows    = rows.filter(r => r.id === wf.id)
                const wfExposed = wfRows.filter(r => !r.masked)
                return (
                  <button
                    key={wf.id}
                    onClick={() => { onClose(); onSelectWorkflow(wf.id) }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{wf.name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {wfRows.map((r, i) => (
                          <span key={i} className={`px-1.5 py-0 text-xs rounded font-medium ${r.masked ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                            {r.node_name ?? r.field_location ?? 'unknown'}
                            {r.masked ? ' (masked)' : ' (exposed)'}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {wf.risk_level && <Badge variant={riskVariant[wf.risk_level]}>{wf.risk_level}</Badge>}
                      {wfExposed.length > 0
                        ? <Badge variant="danger">{wfExposed.length} exposed</Badge>
                        : <Badge variant="success">masked</Badge>}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      }
    </Modal>
  )
}

// ── Hardcoded-secret type drill-down modal ──────────────────────────────────
// Parallel to PiiDrilldownModal. Only ever shows the redacted preview
// (e.g. sk-ant-****7f31) and fingerprint — the raw secret never reaches the SPA.
function SecretDrilldownModal({ secretType, onClose, onSelectWorkflow }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['secret-drilldown', secretType],
    queryFn:  () => workflowGovernance.riskSecretType(secretType),
  })

  const uniqueWf = [...new Map(rows.map(r => [r.id, r])).values()]

  return (
    <Modal title={`${secretType.replace(/_/g, ' ')} — Hardcoded Secrets`} onClose={onClose}>
      {isLoading
        ? <p className="text-sm text-gray-400 py-6 text-center">Loading…</p>
        : (
          <div className="space-y-4">
            <span className="px-2.5 py-1 text-xs font-medium bg-red-100 text-red-700 rounded-full">
              {uniqueWf.length} {uniqueWf.length === 1 ? 'workflow' : 'workflows'} affected
            </span>
            <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
              {uniqueWf.map(wf => {
                const wfRows = rows.filter(r => r.id === wf.id)
                return (
                  <button
                    key={wf.id}
                    onClick={() => { onClose(); onSelectWorkflow(wf.id) }}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors flex items-start justify-between gap-4"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{wf.name}</p>
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {wfRows.map((r, i) => (
                          <span key={i} className="px-1.5 py-0 text-xs rounded font-mono bg-red-50 text-red-700">
                            {r.node_name ?? 'unknown node'} · {r.redacted_preview}
                          </span>
                        ))}
                      </div>
                    </div>
                    {wf.risk_level && <Badge variant={riskVariant[wf.risk_level]}>{wf.risk_level}</Badge>}
                  </button>
                )
              })}
            </div>
          </div>
        )
      }
    </Modal>
  )
}

// ── Workflow detail modal ──────────────────────────────────────────────────
function WorkflowDetail({ workflowId, onClose }) {
  const qc = useQueryClient()
  const { user } = useAuth()

  const { data: wf, isLoading } = useQuery({
    queryKey: ['workflow', workflowId],
    queryFn: () => workflowGovernance.getWorkflow(workflowId),
  })

  // EP-101-S8/S9 — claims a hardcoded-secret finding has been rotated. The
  // finding stays visible until the next scan either drops it (rotated) or
  // reinserts it carrying this same confirmation forward (still exposed).
  const confirmRotation = useMutation({
    mutationFn: (id) => workflowGovernance.confirmSecretRotation(id, user?.username ?? 'unknown'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workflow', workflowId] }),
  })
  const { data: appliedPolicies = [], isLoading: policiesLoading } = useQuery({
    queryKey: ['workflow-policies', workflowId],
    queryFn: () => workflowGovernance.appliedPolicies(workflowId),
    enabled: !!wf?.policies_applied,
  })
  const { data: violations = [] } = useQuery({
    queryKey: ['workflow-violations', workflowId],
    queryFn: () => governance.listViolations({ workflow_id: workflowId }),
    staleTime: 30_000,
  })
  const resolveV = useMutation({
    mutationFn: ({ id, status }) => governance.resolveViolation(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflow-violations', workflowId] })
      qc.invalidateQueries({ queryKey: ['violations-summary'] })
    },
  })
  const { data: riskHistory = [] } = useQuery({
    queryKey: ['workflow-risk-history', workflowId],
    queryFn: () => workflowGovernance.riskHistory(workflowId),
    staleTime: 30_000,
  })

  return (
    <Modal title={wf?.name ?? 'Workflow Detail'} onClose={onClose}>
      {isLoading ? <p className="text-sm text-gray-400 py-4">Loading…</p> : (
        <div className="space-y-5">

          {/* Header badges */}
          <div className="flex items-center gap-2 flex-wrap">
            {wf.risk_level && <Badge variant={riskVariant[wf.risk_level]}>{wf.risk_level}</Badge>}
            <Badge variant={wf.active ? 'success' : 'default'}>{wf.active ? 'active' : 'inactive'}</Badge>
            {wf.platform && <PlatformChip platform={wf.platform ?? 'n8n'} />}
            <RiskBar score={wf.risk_score} />
          </div>

          <OwnershipPanel wf={wf} workflowId={workflowId} />

          {/* AI Governance Policies */}
          {wf.policies_applied && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                <Shield size={12} />
                AI Governance Policies
                {!policiesLoading && appliedPolicies.length > 0 && (
                  <span className="ml-1 px-1.5 py-0 bg-indigo-100 text-indigo-700 rounded text-xs font-medium">
                    {appliedPolicies.length} active
                  </span>
                )}
              </h3>
              {policiesLoading
                ? <p className="text-xs text-gray-400">Loading policies…</p>
                : appliedPolicies.length === 0
                ? (
                  <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-3">
                    Policies were applied but could not be retrieved from governance service.
                  </div>
                )
                : (
                  <div className="space-y-2">
                    {appliedPolicies.map(p => <PolicyCard key={p.id} policy={p} />)}
                  </div>
                )
              }
            </div>
          )}

          {/* Risk breakdown */}
          {wf.risk_breakdown_json?.top_risk_factors?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Detected Risk Signals</h3>
              <div className="flex flex-wrap gap-1.5">
                {wf.risk_breakdown_json.top_risk_factors.map(f => (
                  <span key={f} className="px-2 py-0.5 text-xs bg-red-50 text-red-700 rounded border border-red-100">{f}</span>
                ))}
              </div>
            </div>
          )}

          {/* Risk trend */}
          {riskHistory.length > 1 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                <TrendingUp size={12} />
                Risk Trend ({riskHistory.length} scan{riskHistory.length === 1 ? '' : 's'})
              </h3>
              <div className="h-32 -ml-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={riskHistory.map(h => ({
                    date: new Date(h.scored_at).toLocaleDateString(),
                    score: Number(h.overall_score),
                  }))}>
                    <defs>
                      <linearGradient id="riskTrendFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={28} />
                    <Tooltip />
                    <Area type="monotone" dataKey="score" stroke="#ef4444" fill="url(#riskTrendFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Nodes */}
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Workflow Components ({wf.nodes?.length ?? 0})
            </h3>
            {wf.nodes?.length === 0
              ? <p className="text-sm text-gray-400">No nodes</p>
              : (
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {wf.nodes?.map(n => (
                    <div key={n.id} className="flex items-start justify-between p-2 bg-gray-50 rounded text-xs">
                      <div>
                        <span className="font-medium text-gray-800">{n.node_name}</span>
                        <span className="text-gray-400 ml-1.5">{n.n8n_type}</span>
                        {n.risk_factors?.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {n.risk_factors.map(r => (
                              <span key={r} className="px-1.5 py-0 bg-yellow-50 text-yellow-700 rounded">{r}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <Badge variant={GOV_TYPE_VARIANT[n.governance_type] ?? 'default'}>{n.governance_type}</Badge>
                    </div>
                  ))}
                </div>
              )
            }
          </div>

          {/* PII Exposure */}
          {wf.pii_exposure?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                PII Exposure ({wf.pii_exposure.length})
              </h3>
              <div className="space-y-1.5">
                {wf.pii_exposure.map(p => (
                  <div key={p.id} className="flex items-center justify-between p-2 bg-red-50 rounded text-xs">
                    <div>
                      <span className="font-medium text-red-800">{p.pii_type}</span>
                      {p.node_name && <span className="text-red-500 ml-1.5">in {p.node_name}</span>}
                      {p.field_location && <span className="text-red-400 ml-1.5">· {p.field_location}</span>}
                    </div>
                    <div className="flex gap-1">
                      <Badge variant={p.masked ? 'success' : 'danger'}>{p.masked ? 'masked' : 'exposed'}</Badge>
                      {p.encrypted && <Badge variant="success">encrypted</Badge>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Hardcoded Secret Exposure */}
          {wf.secret_exposure?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                Hardcoded Secrets ({wf.secret_exposure.length})
              </h3>
              <div className="space-y-1.5">
                {wf.secret_exposure.map(s => (
                  <div key={s.id} className="p-2 bg-red-50 rounded text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <span className="font-medium text-red-800">{s.secret_type.replace(/_/g, ' ')}</span>
                        {s.node_name && <span className="text-red-500 ml-1.5">in {s.node_name}</span>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="font-mono text-red-600">{s.redacted_preview}</span>
                        {!s.rotation_confirmed_at && (
                          <Button size="sm" variant="secondary" className="!py-0.5 !px-1.5"
                            onClick={() => confirmRotation.mutate(s.id)}>Mark Rotated</Button>
                        )}
                      </div>
                    </div>
                    {s.rotation_confirmed_at && (
                      <div className="text-red-500 mt-1">
                        Rotation claimed by {s.rotation_confirmed_by} on {new Date(s.rotation_confirmed_at).toLocaleDateString()} — still detected, claim did not hold
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MCP Server References */}
          {wf.mcp_references?.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                MCP Server References ({wf.mcp_references.length})
              </h3>
              <div className="space-y-1.5">
                {wf.mcp_references.map(r => (
                  <div key={r.id} className={`flex items-center justify-between p-2 rounded text-xs ${r.registered ? 'bg-gray-50' : 'bg-red-50'}`}>
                    <div>
                      {/* Epic 2, Feature 2.3 — click through to the registry record for a registered reference */}
                      {r.registered && r.mcp_server_id ? (
                        <Link to={`/mcp-registry?server=${r.mcp_server_id}`} className="font-medium text-indigo-600 hover:underline">
                          {r.mcp_server_name ?? r.server_reference}
                        </Link>
                      ) : (
                        <span className={`font-medium ${r.registered ? 'text-gray-800' : 'text-red-800'}`}>
                          {r.mcp_server_name ?? r.server_reference}
                        </span>
                      )}
                      {r.node_name && <span className={`ml-1.5 ${r.registered ? 'text-gray-400' : 'text-red-500'}`}>in {r.node_name}</span>}
                      {r.malformed && <span className="ml-1.5 text-amber-600" title={r.malformed_reason}>⚠ malformed</span>}
                      {r.ambiguous && (
                        <span className="ml-1.5 text-amber-600" title={(r.ambiguous_candidates ?? []).map(c => c.name).join(', ')}>
                          ⚠ ambiguous ({(r.ambiguous_candidates ?? []).length} matches)
                        </span>
                      )}
                    </div>
                    <Badge variant={r.registered ? 'success' : 'danger'}>
                      {r.registered ? 'registered' : 'unregistered — unassessed'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Policy Violations */}
          {violations.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                <AlertTriangle size={12} className="text-red-400" />
                Policy Violations
                <span className="px-1.5 py-0 bg-red-100 text-red-700 rounded text-xs font-medium">
                  {violations.filter(v => v.status === 'open').length} open
                </span>
              </h3>
              <div className="space-y-1.5">
                {violations.map(v => (
                  <div key={v.id} className={`flex items-start justify-between p-2.5 rounded text-xs gap-2 ${
                    v.status === 'open' ? 'bg-red-50 border border-red-100'
                    : v.status === 'acknowledged' ? 'bg-yellow-50 border border-yellow-100'
                    : 'bg-gray-50 border border-gray-100'
                  }`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <Badge variant={sevVariant[v.severity] ?? 'default'}>{v.severity}</Badge>
                        {v.rule_type && (
                          <span className="text-violet-700 font-medium">{v.rule_type.replace(/_/g, ' ')}</span>
                        )}
                        {v.policy_name && (
                          <span className="text-gray-400">· {v.policy_name}</span>
                        )}
                      </div>
                      <p className="text-gray-700 leading-relaxed">{v.message}</p>
                      <p className="text-gray-400 mt-0.5">{new Date(v.detected_at).toLocaleString()}</p>
                    </div>
                    <div className="shrink-0">
                      {v.status === 'open' && (
                        <button onClick={() => resolveV.mutate({ id: v.id, status: 'acknowledged' })}
                          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-0.5 border border-gray-200 rounded hover:bg-white">
                          Acknowledge
                        </button>
                      )}
                      {v.status === 'acknowledged' && (
                        <button onClick={() => resolveV.mutate({ id: v.id, status: 'resolved' })}
                          className="text-xs text-green-600 hover:text-green-700 px-2 py-0.5 border border-green-200 rounded hover:bg-white">
                          Resolve
                        </button>
                      )}
                      {v.status === 'resolved' && (
                        <span className="text-xs text-green-500">resolved</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tags */}
          {wf.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {wf.tags.map(t => (
                <span key={t} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">{t}</span>
              ))}
            </div>
          )}

          <p className="text-xs text-gray-400">
            Discovered {new Date(wf.discovered_at).toLocaleString()}
            {wf.scored_at && ` · Scored ${new Date(wf.scored_at).toLocaleString()}`}
          </p>
        </div>
      )}
    </Modal>
  )
}

function TagBadge({ name, tagMap = {} }) {
  const meta = tagMap[name.toLowerCase()]
  const style = meta?.color ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style}`}>
      {meta?.role === 'governance' && meta.risk_score != null && (
        <span className="font-bold">{meta.risk_score}</span>
      )}
      {name}
    </span>
  )
}

// ── Platform brand chip ───────────────────────────────────────────────────
const PLATFORM_STYLES = {
  n8n:            'bg-orange-50  text-orange-700  border-orange-200',
  make:           'bg-violet-50  text-violet-700  border-violet-200',
  power_automate: 'bg-blue-50    text-blue-700    border-blue-200',
  zapier:         'bg-amber-50   text-amber-700   border-amber-200',
  camunda:        'bg-red-50     text-red-700     border-red-200',
}
const PLATFORM_LABELS = {
  n8n: 'n8n', make: 'Make', power_automate: 'Power Automate', zapier: 'Zapier', camunda: 'Camunda',
}
function PlatformChip({ platform }) {
  const style = PLATFORM_STYLES[platform] ?? 'bg-gray-50 text-gray-600 border-gray-200'
  return (
    <span className={`inline-flex items-center px-1.5 py-0 text-xs rounded border font-medium ${style}`}>
      {PLATFORM_LABELS[platform] ?? platform}
    </span>
  )
}

// ── AI Governance Analysis modal ──────────────────────────────────────────
function AnalysisModal({ workflowId, workflowName, onClose }) {
  const [jobId,    setJobId]    = useState(null)
  const [triggerError, setTriggerError] = useState(null)

  // Trigger the analysis job
  const trigger = useMutation({
    mutationFn: () => workflowGovernance.analyzeWorkflow(workflowId),
    onSuccess:  data => { setJobId(data.job_id); setTriggerError(null) },
    onError:    err  => setTriggerError(err.message),
  })

  // Auto-trigger on mount
  useEffect(() => { trigger.mutate() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Poll until terminal state
  const { data: job } = useQuery({
    queryKey: ['analysis', jobId],
    queryFn:  () => workflowGovernance.getAnalysis(jobId),
    enabled:  !!jobId,
    refetchInterval: query => (query.state.data?.status === 'pending' ? 3000 : false),
  })

  const isPending  = !job || job.status === 'pending'
  const isFailed   = job?.status === 'failed'
  const isDone     = job?.status === 'completed'
  const canRetry   = isFailed && job.retry_count < job.max_retries

  function retry() {
    setJobId(null)
    setTriggerError(null)
    trigger.mutate()
  }

  return (
    <Modal title={`AI Analysis — ${workflowName}`} onClose={onClose}>
      <div className="min-h-[200px]">

        {/* Trigger error (before a job_id exists) */}
        {triggerError && !jobId && (
          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {triggerError}
            </div>
            <Button onClick={retry} variant="secondary">Retry</Button>
          </div>
        )}

        {/* Pending / in-flight */}
        {!triggerError && isPending && (
          <div className="py-14 flex flex-col items-center gap-4 text-center">
            <div className="relative">
              <Sparkles size={28} className="text-indigo-300" />
              <div className="absolute inset-0 flex items-center justify-center">
                <RefreshCw size={14} className="animate-spin text-indigo-500" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-700">AI agent is reviewing governance posture…</p>
              <p className="text-xs text-gray-400 mt-1">Analysing risk signals, tag declarations, and structural controls</p>
            </div>
          </div>
        )}

        {/* Failed */}
        {isFailed && (
          <div className="space-y-4">
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                <XCircle size={15} /> Analysis failed
              </p>
              <p className="text-xs text-red-500 mt-1 font-mono">{job.error}</p>
            </div>
            {canRetry
              ? <Button onClick={retry} variant="secondary"><RefreshCw size={13} />Retry Analysis</Button>
              : <p className="text-xs text-gray-400">Max retries ({job.max_retries}) reached for this workflow.</p>
            }
          </div>
        )}

        {/* Completed */}
        {isDone && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-md px-3 py-2">
              <CheckCircle2 size={13} />
              Analysis completed · {new Date(job.completed_at).toLocaleString()}
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 max-h-[420px] overflow-y-auto">
              <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed font-sans">
                {job.analysis}
              </p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" variant="secondary" onClick={retry}>
                <Sparkles size={13} />Re-analyse
              </Button>
            </div>
          </div>
        )}

      </div>
    </Modal>
  )
}

// ── Import workflow — multi-platform picker ────────────────────────────────
function ImportModal({ onClose, onImported }) {
  const [selected,          setSelected]          = useState(null)
  const [result,            setResult]            = useState(null)
  const [activePlatform,    setActivePlatform]    = useState('n8n')
  const [makeConnectionId,  setMakeConnectionId]  = useState('')
  const [zapierConnectionId,  setZapierConnectionId]  = useState('')
  const [camundaConnectionId, setCamundaConnectionId] = useState('')
  const [paConnectionId,      setPaConnectionId]      = useState('')

  const { tagMap, folderTags } = useTags()
  const folderTagNames = new Set(folderTags.map(t => t.name.toLowerCase()))

  // Platform connections — used to discover which platforms are available
  const { data: connections = [] } = useQuery({
    queryKey: ['platform-connections'],
    queryFn:  platformsApi.list,
    staleTime: 60_000,
  })
  const n8nConnections     = connections.filter(c => c.platform === 'n8n'     && c.status === 'connected')
  const makeConnections    = connections.filter(c => c.platform === 'make'    && c.status === 'connected')
  const zapierConnections  = connections.filter(c => c.platform === 'zapier'  && c.status === 'connected')
  const camundaConnections = connections.filter(c => c.platform === 'camunda' && c.status === 'connected')
  const paConnections      = connections.filter(c => c.platform === 'power_automate' && c.status === 'connected')

  // Auto-select first connection per platform when connections load
  useEffect(() => {
    if (makeConnections.length   > 0 && !makeConnectionId)   setMakeConnectionId(makeConnections[0].id)
  }, [makeConnections.length])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (zapierConnections.length > 0 && !zapierConnectionId) setZapierConnectionId(zapierConnections[0].id)
  }, [zapierConnections.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (camundaConnections.length > 0 && !camundaConnectionId) setCamundaConnectionId(camundaConnections[0].id)
  }, [camundaConnections.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first Zapier connection when connections load
  useEffect(() => {
    if (zapierConnections.length > 0 && !zapierConnectionId) {
      setZapierConnectionId(zapierConnections[0].id)
    }
  }, [zapierConnections.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select first Camunda connection when connections load
  useEffect(() => {
    if (camundaConnections.length > 0 && !camundaConnectionId) {
      setCamundaConnectionId(camundaConnections[0].id)
    }
  }, [camundaConnections.length]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (paConnections.length > 0 && !paConnectionId) {
      setPaConnectionId(paConnections[0].id)
    }
  }, [paConnections.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // n8n workflows
  const { data: n8nList = [], isLoading: n8nLoading, error: n8nError } = useQuery({
    queryKey: ['n8n-workflows'],
    queryFn:  workflowGovernance.n8nWorkflows,
    enabled:  activePlatform === 'n8n',
    staleTime: 60_000,
  })
  // Make.com scenarios
  const { data: makeList = [], isLoading: makeLoading, error: makeError } = useQuery({
    queryKey: ['make-workflows', makeConnectionId],
    queryFn:  () => workflowGovernance.makeWorkflows(makeConnectionId),
    enabled:  activePlatform === 'make' && !!makeConnectionId,
    staleTime: 60_000,
  })
  // Zapier Zaps
  const { data: zapierList = [], isLoading: zapierLoading, error: zapierError } = useQuery({
    queryKey: ['zapier-workflows', zapierConnectionId],
    queryFn:  () => workflowGovernance.zapierWorkflows(zapierConnectionId),
    enabled:  activePlatform === 'zapier' && !!zapierConnectionId,
    staleTime: 60_000,
  })
  // Camunda process definitions
  const { data: camundaList = [], isLoading: camundaLoading, error: camundaError } = useQuery({
    queryKey: ['camunda-workflows', camundaConnectionId],
    queryFn:  () => workflowGovernance.camundaWorkflows(camundaConnectionId),
    enabled:  activePlatform === 'camunda' && !!camundaConnectionId,
    staleTime: 60_000,
  })
  // Power Automate flows
  const { data: paList = [], isLoading: paLoading, error: paError } = useQuery({
    queryKey: ['pa-workflows', paConnectionId],
    queryFn:  () => workflowGovernance.paWorkflows(paConnectionId),
    enabled:  activePlatform === 'power_automate' && !!paConnectionId,
    staleTime: 60_000,
  })

  const importMutation = useMutation({
    mutationFn: body => workflowGovernance.importWorkflow(body),
    onSuccess:  data => setResult(data),
  })

  function handlePlatformSwitch(platform) {
    setActivePlatform(platform)
    setSelected(null)
  }

  function handleImport() {
    if (activePlatform === 'n8n') {
      importMutation.mutate({ n8n_id: selected.id })
    } else if (activePlatform === 'make') {
      importMutation.mutate({ platform: 'make', connection_id: makeConnectionId, source_id: selected.sourceId })
    } else if (activePlatform === 'zapier') {
      importMutation.mutate({ platform: 'zapier', connection_id: zapierConnectionId, source_id: selected.sourceId })
    } else if (activePlatform === 'camunda') {
      importMutation.mutate({ platform: 'camunda', connection_id: camundaConnectionId, source_id: selected.sourceId })
    } else if (activePlatform === 'power_automate') {
      importMutation.mutate({ platform: 'power_automate', connection_id: paConnectionId, source_id: selected.sourceId })
    }
  }

  // n8n tag preview helpers
  const previewTags    = selected?.tags ?? []
  const govMatchedTags = previewTags.filter(n => {
    const meta = tagMap[n.toLowerCase()]
    return meta?.role === 'governance' && meta.risk_score != null
  })
  const unknownTags  = previewTags.filter(n => !tagMap[n.toLowerCase()])
  const previewScore = activePlatform === 'n8n' && govMatchedTags.length
    ? Math.min(100, Math.round(
        govMatchedTags.reduce((s, n) => s + (tagMap[n.toLowerCase()]?.risk_score ?? 0), 0) / govMatchedTags.length
        + (govMatchedTags.length - 1) * 5
      ))
    : null
  const previewLevel = previewScore == null ? null
    : previewScore < 30 ? 'LOW' : previewScore < 60 ? 'MEDIUM' : previewScore < 80 ? 'HIGH' : 'CRITICAL'

  // ── Success panel ─────────────────────────────────────────────────────────
  if (result) {
    return (
      <Modal title="Workflow Imported" onClose={onClose}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
            <CheckCircle2 size={22} className="text-green-600 shrink-0" />
            <div>
              <div className="font-semibold text-green-800">{result.name} imported</div>
              <div className="text-sm text-green-700 mt-0.5">
                Risk score: <strong>{result.risk_score}</strong> —{' '}
                <Badge variant={riskVariant[result.risk_level]}>{result.risk_level}</Badge>
              </div>
            </div>
          </div>

          {result.tag_dimension?.factors?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Governance tag signals</div>
              <ul className="space-y-1">
                {result.tag_dimension.factors.map(f => (
                  <li key={f} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-purple-400 mt-0.5 shrink-0">◆</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.top_risk_factors?.length > 0 && (
            <div>
              <div className="text-xs font-semibold text-gray-500 uppercase mb-2">Top overall risk factors</div>
              <ul className="space-y-1">
                {result.top_risk_factors.map(f => (
                  <li key={f} className="text-sm text-gray-700 flex items-start gap-2">
                    <span className="text-orange-400 mt-0.5 shrink-0">•</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setResult(null)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">
              Import Another
            </button>
            <button
              onClick={() => { onImported(); onClose() }}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700"
            >
              View in Workflows
            </button>
          </div>
        </div>
      </Modal>
    )
  }

  // ── Picker panel ──────────────────────────────────────────────────────────
  const isN8n     = activePlatform === 'n8n'
  const isMake    = activePlatform === 'make'
  const isZapier  = activePlatform === 'zapier'
  const isCamunda = activePlatform === 'camunda'
  const isPA      = activePlatform === 'power_automate'

  const isLoading  = isN8n ? n8nLoading  : isMake ? makeLoading  : isZapier ? zapierLoading  : isCamunda ? camundaLoading  : paLoading
  const listError  = isN8n ? n8nError    : isMake ? makeError    : isZapier ? zapierError    : isCamunda ? camundaError    : paError
  const activeList = isN8n ? n8nList     : isMake ? makeList     : isZapier ? zapierList     : isCamunda ? camundaList     : paList

  // Platform tabs — only show tabs for platforms that have connections
  const platformTabs = [
    { key: 'n8n',             label: 'n8n' },
    ...(makeConnections.length    > 0 ? [{ key: 'make',            label: 'Make.com' }]        : []),
    ...(zapierConnections.length  > 0 ? [{ key: 'zapier',          label: 'Zapier' }]          : []),
    ...(camundaConnections.length > 0 ? [{ key: 'camunda',         label: 'Camunda' }]         : []),
    ...(paConnections.length      > 0 ? [{ key: 'power_automate',  label: 'Power Automate' }]  : []),
  ]

  const activeConnectionId = isMake ? makeConnectionId : isZapier ? zapierConnectionId : isCamunda ? camundaConnectionId : paConnectionId
  const activeConnections  = isMake ? makeConnections : isZapier ? zapierConnections : isCamunda ? camundaConnections : paConnections

  const listLabel = isN8n ? 'workflow from n8n'
    : isMake ? 'scenario from Make.com'
    : isZapier ? 'Zap from Zapier'
    : isCamunda ? 'process definition from Camunda'
    : 'flow from Power Automate'

  return (
    <Modal title="Import Workflow" onClose={onClose}>
      <div className="space-y-4">

        {/* Platform tabs — shown when any non-n8n connections exist */}
        {platformTabs.length > 1 && (
          <div className="flex gap-1 border-b border-gray-200">
            {platformTabs.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => handlePlatformSwitch(key)}
                className={`px-4 py-2 text-sm transition-colors ${
                  activePlatform === key
                    ? 'border-b-2 border-indigo-600 text-indigo-700 font-medium'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Connection selector — shown when multiple connections for the active platform */}
        {!isN8n && activeConnections.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 shrink-0">Connection:</span>
            <select
              value={activeConnectionId}
              onChange={e => {
                const val = e.target.value
                if (isMake)    setMakeConnectionId(val)
                if (isZapier)  setZapierConnectionId(val)
                if (isCamunda) setCamundaConnectionId(val)
                setSelected(null)
              }}
              className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
            >
              {activeConnections.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Zapier connection selector — shown when multiple Zapier connections */}
        {isZapier && zapierConnections.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 shrink-0">Connection:</span>
            <select
              value={zapierConnectionId}
              onChange={e => { setZapierConnectionId(e.target.value); setSelected(null) }}
              className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
            >
              {zapierConnections.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Camunda connection selector — shown when multiple Camunda connections */}
        {isCamunda && camundaConnections.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600 shrink-0">Connection:</span>
            <select
              value={camundaConnectionId}
              onChange={e => { setCamundaConnectionId(e.target.value); setSelected(null) }}
              className="flex-1 text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white"
            >
              {camundaConnections.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Workflow list */}
        <div>
          <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
            Select a {listLabel}
          </div>

          {isLoading && <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>}
          {listError && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
              {listError.message}
            </div>
          )}

          {!isLoading && !listError && activeList.length === 0 && (
            <p className="text-sm text-gray-400 py-4 text-center">
              No {isN8n ? 'workflows' : isMake ? 'scenarios' : isZapier ? 'Zaps' : 'process definitions'} found
            </p>
          )}

          {!isLoading && !listError && activeList.length > 0 && (() => {
            // Build groups: n8n groups by folder tags, Make groups by folderName, Zapier is flat
            const groups = {}

            if (isN8n) {
              for (const wf of n8nList) {
                const wfFolderTags = (wf.tags ?? []).filter(t => folderTagNames.has(t.toLowerCase()))
                if (wfFolderTags.length === 0) {
                  (groups['__none__'] = groups['__none__'] ?? []).push(wf)
                } else {
                  for (const tag of wfFolderTags) {
                    const key = tag.toLowerCase()
                    ;(groups[key] = groups[key] ?? []).push(wf)
                  }
                }
              }
            } else if (isMake) {
              for (const sc of makeList) {
                const key = sc.folderName ?? '__none__'
                ;(groups[key] = groups[key] ?? []).push(sc)
              }
            } else if (isZapier) {
              groups['__none__'] = zapierList
            } else {
              groups['__none__'] = camundaList
            }

            const sortedKeys = Object.keys(groups).sort((a, b) => {
              if (a === '__none__') return 1
              if (b === '__none__') return -1
              return a.localeCompare(b)
            })

            return (
              <div className="max-h-64 overflow-y-auto border border-gray-200 rounded-lg">
                {sortedKeys.map(key => (
                  <div key={key}>
                    <div className="sticky top-0 z-10 px-4 py-1.5 bg-gray-100 border-b border-gray-200 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                        {key === '__none__'
                          ? (isN8n ? 'Untagged' : isZapier ? 'All Zaps' : isCamunda ? 'All Processes' : 'No Folder')
                          : (isN8n ? (tagMap[key]?.name ?? key) : key)}
                      </span>
                      <span className="text-xs text-gray-400">{groups[key].length}</span>
                    </div>
                    {groups[key].map(item => {
                      const itemKey  = isN8n ? item.id : item.sourceId
                      const selKey   = isN8n ? selected?.id : selected?.sourceId
                      const isActive = item.active ?? false
                      return (
                        <button
                          key={itemKey}
                          onClick={() => setSelected(item)}
                          className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-0 ${
                            selKey === itemKey ? 'bg-indigo-50 border-l-2 border-indigo-500' : ''
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {(isMake || isZapier) && item.stepCount != null && (
                                <span className="text-xs text-gray-400">{item.stepCount} steps</span>
                              )}
                              {isCamunda && item.version != null && (
                                <span className="text-xs text-gray-400">v{item.version}</span>
                              )}
                              <Badge variant={isActive ? 'success' : 'default'}>
                                {isActive ? 'active' : 'inactive'}
                              </Badge>
                            </div>
                          </div>
                          {isN8n && item.tags?.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {item.tags.map(t => <TagBadge key={t} name={t} tagMap={tagMap} />)}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })()}
        </div>

        {/* Selection preview */}
        {selected && (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-gray-800">{selected.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {isN8n ? `n8n ID: ${selected.id}` : isZapier ? `Zap ID: ${selected.sourceId}` : isCamunda ? `Process key: ${selected.key ?? selected.sourceId}` : `Scenario ID: ${selected.sourceId}`}
                </div>
              </div>
              {isN8n && previewLevel && (
                <div className="text-right">
                  <Badge variant={riskVariant[previewLevel]}>~{previewScore} {previewLevel}</Badge>
                  <div className="text-xs text-gray-400 mt-1">tag-based preview</div>
                </div>
              )}
            </div>

            {isN8n && govMatchedTags.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase mb-1.5">Governance signals from tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {govMatchedTags.map(n => <TagBadge key={n} name={n} tagMap={tagMap} />)}
                </div>
              </div>
            )}
            {isN8n && unknownTags.length > 0 && (
              <div className="text-xs text-gray-400">
                Also tagged: {unknownTags.join(', ')} — no registry mapping
              </div>
            )}
            {!isN8n && selected.folderName && (
              <div className="text-xs text-gray-500">Folder: {selected.folderName}</div>
            )}
          </div>
        )}

        {importMutation.error && (
          <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
            <XCircle size={14} className="shrink-0" />{importMutation.error.message}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
          <button
            disabled={!selected || importMutation.isPending}
            onClick={handleImport}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-40"
          >
            <Upload size={14} />
            {importMutation.isPending ? 'Importing…' : 'Import & Score'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Inline policy pills — lazy-fetched per row ───────────────────────────
function RowPolicies({ workflowId }) {
  const [open, setOpen] = useState(false)
  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['workflow-policies', workflowId],
    queryFn:  () => workflowGovernance.appliedPolicies(workflowId),
    enabled:  open,
    staleTime: 5 * 60_000,
  })

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="text-left hover:opacity-80 transition-opacity"
        title="Click to see applied policies">
        <Badge variant="info">policies applied</Badge>
      </button>
    )
  }

  if (isLoading) return <span className="text-xs text-gray-400">Loading…</span>

  if (policies.length === 0) {
    return <span className="text-xs text-gray-400">none found</span>
  }

  const seen = new Set()
  return (
    <div className="flex flex-wrap gap-1">
      {policies.map(p => {
        const pType = p.metadata_json?.policy_type ?? 'guardrail'
        if (seen.has(pType)) return null
        seen.add(pType)
        const display = POLICY_DISPLAY[pType] ?? POLICY_DISPLAY.guardrail
        return (
          <span key={pType} className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${display.badge}`}>
            {display.label}
          </span>
        )
      })}
    </div>
  )
}

// ── InfoTip lookup maps ────────────────────────────────────────────────────
const GOV_TYPE_TIPS = {
  transform:    help.wf.typeTransform,
  ai_inference: help.wf.typeAiInference,
  http:         help.wf.typeHttp,
  database:     help.wf.typeDatabase,
  webhook:      help.wf.typeWebhook,
  schedule:     help.wf.typeSchedule,
  approval:     help.wf.typeApproval,
}

const RISK_FACTOR_TIPS = {
  arbitrary_code_execution: help.wf.riskArbitraryCode,
  file_system_access:       help.wf.riskFileSystem,
  no_system_prompt:         help.wf.riskNoSystemPrompt,
  no_token_limit:           help.wf.riskNoTokenLimit,
  no_auth_header:           help.wf.riskNoAuthHeader,
  no_timeout:               help.wf.riskNoTimeout,
  raw_sql_execution:        help.wf.riskRawSql,
  deprecated_model:         help.wf.riskDeprecatedModel,
}

// ── Page ───────────────────────────────────────────────────────────────────
export function WorkflowGovernance() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [tab, setTab] = useState('summary')
  const [riskFilter,     setRiskFilter]     = useState('')
  const [activeFilter,   setActiveFilter]   = useState('')
  const [platformFilter, setPlatformFilter] = useState('')
  const [selectedId,     setSelectedId]     = useState(null)
  const [showImport,     setShowImport]     = useState(false)
  const [analyzing,      setAnalyzing]      = useState(null) // { id, name }
  const [projectFilter,  setProjectFilter]  = useState('')
  const [applyResult,    setApplyResult]    = useState(null) // { workflowName, applied, policies }
  const [piiDrilldown,   setPiiDrilldown]   = useState(null) // pii_type string
  const [secretDrilldown, setSecretDrilldown] = useState(null) // secret_type string
  const [sortCol,        setSortCol]        = useState('risk_score')
  const [sortDir,        setSortDir]        = useState('desc')

  // All connected platform integrations — powers the Discover dropdown
  const { data: connections = [] } = useQuery({
    queryKey: ['platform-connections'],
    queryFn:  platformsApi.list,
    staleTime: 60_000,
  })
  const discoverConnections = connections.filter(c => c.status === 'connected')
  const [discoverConnectionId, setDiscoverConnectionId] = useState('')
  useEffect(() => {
    if (discoverConnections.length > 0 && !discoverConnectionId) setDiscoverConnectionId(discoverConnections[0].id)
  }, [discoverConnections.length]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['wf-risk-summary'],
    queryFn: workflowGovernance.riskSummary,
    enabled: tab === 'summary',
    refetchInterval: tab === 'summary' ? 30_000 : false,
  })

  const { data: violationSummary = [] } = useQuery({
    queryKey: ['violations-summary'],
    queryFn: governance.violationSummary,
    enabled: tab === 'workflows',
    staleTime: 30_000,
  })
  const violationMap = useMemo(
    () => Object.fromEntries(violationSummary.map(v => [v.workflow_id, v])),
    [violationSummary]
  )

  const evaluate = useMutation({
    mutationFn: workflowId => governance.evaluateWorkflow(workflowId),
    onSuccess: (_, workflowId) => {
      qc.invalidateQueries({ queryKey: ['violations-summary'] })
      qc.invalidateQueries({ queryKey: ['workflow-violations', workflowId] })
    },
  })

  const { data: workflows = [], isLoading: wfLoading } = useQuery({
    queryKey: ['workflows', riskFilter, activeFilter, projectFilter, platformFilter],
    queryFn: () => workflowGovernance.listWorkflows({
      ...(riskFilter         && { risk_level: riskFilter }),
      ...(activeFilter !== '' && { active: activeFilter }),
      ...(projectFilter  && { project_id: projectFilter }),
      ...(platformFilter && { platform: platformFilter }),
    }),
    enabled: tab === 'workflows',
  })

  // Derive unique projects from loaded workflows for the filter dropdown
  const projectOptions = [...new Map(
    workflows.filter(w => w.project_id)
      .map(w => [w.project_id, { id: w.project_id, name: w.project_name }])
  ).values()]

  const { data: nodes = [], isLoading: nodesLoading } = useQuery({
    queryKey: ['wf-risk-nodes'],
    queryFn: workflowGovernance.riskNodes,
    enabled: tab === 'nodes',
  })

  const { data: byDomain = [], isLoading: byDomainLoading } = useQuery({
    queryKey: ['wf-risk-by-domain'],
    queryFn: workflowGovernance.riskByDomain,
    enabled: tab === 'domain',
  })

  const discover = useMutation({
    mutationFn: () => workflowGovernance.discover(discoverConnectionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-summary'] })
    },
  })

  const clearAll = useMutation({
    mutationFn: workflowGovernance.clearAll,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-summary'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-nodes'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-by-domain'] })
    },
  })

  const backup = useMutation({
    mutationFn: workflowGovernance.exportBackup,
    onSuccess: data => downloadJson(data, `ioa-workflow-backup-${data.exported_at.slice(0, 10)}.json`),
  })

  const restoreFileRef = useRef(null)
  const restore = useMutation({
    mutationFn: workflowGovernance.restoreBackup,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-summary'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-nodes'] })
      qc.invalidateQueries({ queryKey: ['wf-risk-by-domain'] })
    },
  })

  async function handleRestoreFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file next time
    if (!file) return
    let backup
    try {
      backup = JSON.parse(await file.text())
    } catch {
      return window.alert('That file is not valid JSON — expected a backup downloaded from the Backup button.')
    }
    const ok = await confirm({
      title:        'Restore Workflows',
      message:      `Restore ${backup.tables?.workflows?.length ?? 0} workflow(s) from this backup (exported ${backup.exported_at ? new Date(backup.exported_at).toLocaleString() : 'unknown time'})? This only works if there are currently zero workflows — run Clear All first if needed.`,
      confirmLabel: 'Restore',
    })
    if (ok) restore.mutate(backup)
  }

  async function handleClearAll() {
    const ok = await confirm({
      title:        'Clear All Workflows',
      message:      `Delete all ${summary?.total_workflows ?? ''} imported workflows and everything derived from them (risk scores, PII/secret findings, lineage, assurance evidence)? This cannot be undone. Use Backup first if you want to keep a copy — policies and MCP setups aren't affected either way.`,
      confirmLabel: 'Delete All',
    })
    if (ok) clearAll.mutate()
  }

  const score = useMutation({
    mutationFn: workflowGovernance.scoreWorkflow,
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow', id] })
      qc.invalidateQueries({ queryKey: ['wf-risk-summary'] })
    },
  })

  const applyPolicies = useMutation({
    mutationFn: workflowGovernance.applyPolicies,
    onSuccess: (data, id) => {
      qc.invalidateQueries({ queryKey: ['workflows'] })
      qc.invalidateQueries({ queryKey: ['workflow', id] })
      const wf = workflows.find(w => w.id === id || w.n8n_id === id)
      setApplyResult({ workflowName: wf?.name ?? id, applied: data.applied, policies: data.policies ?? [] })
    },
  })

  const sortedWorkflows = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...workflows].sort((a, b) => {
      switch (sortCol) {
        case 'name':       return dir * (a.name ?? '').localeCompare(b.name ?? '')
        case 'platform':   return dir * (a.platform ?? 'n8n').localeCompare(b.platform ?? 'n8n')
        case 'project':    return dir * (a.project_name ?? '').localeCompare(b.project_name ?? '')
        case 'risk_level': return dir * ((RISK_ORDER[a.risk_level] ?? 0) - (RISK_ORDER[b.risk_level] ?? 0))
        case 'risk_score': return dir * ((a.risk_score ?? -1) - (b.risk_score ?? -1))
        case 'active':           return dir * ((a.active ? 1 : 0) - (b.active ? 1 : 0))
        case 'policies_applied': return dir * ((a.policies_applied ? 1 : 0) - (b.policies_applied ? 1 : 0))
        case 'violations':       return dir * (Number(violationMap[a.id]?.open ?? 0) - Number(violationMap[b.id]?.open ?? 0))
        case 'scored_at':        return dir * (new Date(a.scored_at ?? 0) - new Date(b.scored_at ?? 0))
        default: return 0
      }
    })
  }, [workflows, sortCol, sortDir, violationMap])

  function toggleWfSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'risk_score' || col === 'risk_level' || col === 'policies_applied' || col === 'violations' ? 'desc' : 'asc') }
  }

  function SortTh({ col, children }) {
    const active = sortCol === col
    return (
      <Th>
        <button onClick={() => toggleWfSort(col)}
          className="flex items-center gap-1 hover:text-gray-900 transition-colors select-none whitespace-nowrap">
          {children}
          <span className="flex flex-col -space-y-1">
            <ChevronUp  size={10} className={active && sortDir === 'asc'  ? 'text-indigo-600' : 'text-gray-300'} />
            <ChevronDown size={10} className={active && sortDir === 'desc' ? 'text-indigo-600' : 'text-gray-300'} />
          </span>
        </button>
      </Th>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            Workflow Governance
            <InfoTip content={help.wf.pageTitle} side="right" size={15} />
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center">
            Workflow risk scoring, PII detection, and policy enforcement
            <InfoTip content={help.wf.subtitle} side="bottom" />
          </p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Upload size={15} />Import Workflow
            </Button>
            <InfoTip content={help.wf.importButton} side="bottom" />
          </div>
          <div className="flex items-center gap-2">
            {discoverConnections.length > 1 && (
              <Select
                value={discoverConnectionId}
                onChange={e => setDiscoverConnectionId(e.target.value)}
                className="w-48"
                aria-label="Platform connection to discover from"
              >
                {discoverConnections.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({({ n8n: 'n8n', make: 'Make', zapier: 'Zapier', power_automate: 'Power Automate', camunda: 'Camunda' })[c.platform] ?? c.platform})
                  </option>
                ))}
              </Select>
            )}
            <Button
              onClick={() => discover.mutate()}
              disabled={discover.isPending || discoverConnections.length === 0}
            >
              <RefreshCw size={15} className={discover.isPending ? 'animate-spin' : ''} />
              {discover.isPending ? 'Discovering…' : 'Discover Workflows'}
            </Button>
            <InfoTip
              content={
                discoverConnections.length === 0
                  ? 'Configure a platform connection under Administration → Integrations before discovering workflows.'
                  : discoverConnections.length > 1
                  ? 'Pulls workflows from the selected platform connection.'
                  : help.wf.discoverButton
              }
              side="bottom"
            />
          </div>
          {hasPermission('workflow:manage') && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => backup.mutate()}
                disabled={backup.isPending || !summary?.total_workflows}
              >
                <Download size={15} />
                {backup.isPending ? 'Backing up…' : 'Backup'}
              </Button>
              <InfoTip content="Downloads every imported workflow and everything derived from it (risk scores, findings, lineage, assurance evidence) as a JSON file. Nothing on the server changes — safe to run any time, and worth doing right before Clear All." side="bottom" />
            </div>
          )}
          {hasPermission('workflow:manage') && (
            <div className="flex items-center gap-2">
              <input
                ref={restoreFileRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={handleRestoreFile}
              />
              <Button
                variant="secondary"
                onClick={() => restoreFileRef.current?.click()}
                disabled={restore.isPending}
              >
                <ArchiveRestore size={15} />
                {restore.isPending ? 'Restoring…' : 'Restore'}
              </Button>
              <InfoTip content="Imports a workflow backup JSON file downloaded from Backup. Only works into an empty environment (zero current workflows) — this platform's own backup/restore format, not a general import of arbitrary data. Run Clear All first if needed." side="bottom" />
            </div>
          )}
          {hasPermission('workflow:manage') && (
            <div className="flex items-center gap-2">
              <Button variant="danger" onClick={handleClearAll} disabled={clearAll.isPending || !summary?.total_workflows}>
                <Trash2 size={15} />
                {clearAll.isPending ? 'Clearing…' : 'Clear All'}
              </Button>
              <InfoTip content="Permanently deletes every imported workflow and everything derived from it (risk scores, findings, lineage). Platform-admin only." side="bottom" />
            </div>
          )}
        </div>
      </div>

      {/* Discover result feedback */}
      {discover.isSuccess && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-2 flex items-center">
          Discovered {discover.data?.discovered ?? 0} workflows from {discover.data?.platform ?? 'platform'}.
          <InfoTip content={help.wf.discoveredCount} side="right" />
        </div>
      )}
      {discover.isError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-2">
          {discover.error?.message}
        </div>
      )}

      {/* Restore result feedback */}
      {restore.isSuccess && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-2">
          Restored {restore.data?.restored?.workflows ?? 0} workflows.
        </div>
      )}
      {restore.isError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-2">
          {restore.error?.message}
        </div>
      )}

      {/* Clear-all result feedback */}
      {clearAll.isSuccess && (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-md px-4 py-2">
          Deleted {clearAll.data?.deleted ?? 0} workflows.
        </div>
      )}
      {clearAll.isError && (
        <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md px-4 py-2">
          {clearAll.error?.message}
        </div>
      )}
      {confirmDialog}

      {/* Apply-policies result feedback */}
      {applyResult && (
        <div className="bg-green-50 border border-green-200 rounded-md px-4 py-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-green-800">
              {applyResult.applied} AI Governance {applyResult.applied === 1 ? 'Policy' : 'Policies'} applied to “{applyResult.workflowName}”
            </p>
            {applyResult.policies.length > 0 && (
              <ul className="mt-1 flex flex-wrap gap-2">
                {applyResult.policies.map(p => {
                  const pType = p.metadata_json?.policy_type ?? 'guardrail'
                  const display = POLICY_DISPLAY[pType] ?? POLICY_DISPLAY.guardrail
                  return (
                    <li key={p.id ?? p.name}
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${display.badge}`}>
                      {display.label}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          <button onClick={() => setApplyResult(null)}
            className="text-green-600 hover:text-green-800 text-xs shrink-0 mt-0.5">
            ✕
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'summary',   label: 'Summary',    tip: help.wf.summaryTab },
          { key: 'workflows', label: 'Workflows',   tip: help.wf.workflowsTab },
          { key: 'nodes',     label: 'Node Types',  tip: help.wf.nodeTypesTab },
          { key: 'domain',    label: 'By Domain',   tip: 'Risk rolled up by business_domain — populate via domain:<name> tags' },
        ].map(({ key, label, tip }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center px-4 py-2 text-sm transition-colors ${tab === key
              ? 'border-b-2 border-indigo-600 text-indigo-700 font-medium'
              : 'text-gray-500 hover:text-gray-700'}`}>
            {label}
            <InfoTip content={tip} side="bottom" />
          </button>
        ))}
      </div>

      {/* ── Summary tab ── */}
      {tab === 'summary' && (
        <div className="space-y-6">
          {summaryLoading ? <p className="text-sm text-gray-400">Loading…</p> : summary ? (
            <>
              {/* Stat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard icon={GitBranch} label="Total Workflows"   value={summary.total_workflows}   color="indigo" />
                <StatCard icon={Play}      label="Active"            value={summary.active_workflows}  color="green" />
                <StatCard icon={AlertTriangle} label="Scored"        value={summary.scored_workflows}  color="yellow"
                  sub={summary.avg_risk_score != null ? `avg score ${summary.avg_risk_score}` : null} />
                <StatCard icon={Shield}    label="AI Policies Applied"  value={summary.policies_applied}  color="indigo"
                  onClick={() => {
                    setTab('workflows')
                    setSortCol('policies_applied')
                    setSortDir('desc')
                    setRiskFilter('')
                    setActiveFilter('')
                    setPlatformFilter('')
                    setProjectFilter('')
                  }} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Risk distribution */}
                <Card>
                  <CardHeader><span className="text-sm font-semibold text-gray-700">Risk Distribution</span></CardHeader>
                  <CardContent className="py-4">
                    {summary.risk_distribution?.length === 0
                      ? <p className="text-sm text-gray-400">No scored workflows yet</p>
                      : summary.risk_distribution?.map(r => (
                        <div key={r.risk_level} className="flex items-center gap-3 mb-3">
                          <Badge variant={riskVariant[r.risk_level]}>{r.risk_level}</Badge>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                r.risk_level === 'CRITICAL' ? 'bg-purple-500' :
                                r.risk_level === 'HIGH'     ? 'bg-red-400' :
                                r.risk_level === 'MEDIUM'   ? 'bg-yellow-400' : 'bg-green-400'}`}
                              style={{ width: `${Math.round((r.count / (summary.total_workflows || 1)) * 100)}%` }}
                            />
                          </div>
                          <span className="text-sm text-gray-600 tabular-nums w-6 text-right">{r.count}</span>
                        </div>
                      ))
                    }
                  </CardContent>
                </Card>

                {/* PII exposure summary */}
                <Card>
                  <CardHeader><span className="text-sm font-semibold text-gray-700">PII Exposure by Type</span></CardHeader>
                  <CardContent className="py-4">
                    {summary.pii_exposure_summary?.length === 0
                      ? <p className="text-sm text-gray-400">No PII exposure detected</p>
                      : (
                        <table className="w-full text-xs">
                          <thead><tr className="text-gray-400 uppercase text-left">
                            <th className="pb-2">Type</th><th className="pb-2">Workflows</th><th className="pb-2">Unmasked</th>
                          </tr></thead>
                          <tbody>
                            {summary.pii_exposure_summary?.map(p => (
                              <tr key={p.pii_type}
                                className="border-t border-gray-100 cursor-pointer hover:bg-indigo-50 transition-colors"
                                onClick={() => setPiiDrilldown(p.pii_type)}
                              >
                                <td className="py-1.5 font-medium text-indigo-700 underline decoration-dotted">{p.pii_type}</td>
                                <td className="py-1.5 text-gray-500">{p.workflow_count}</td>
                                <td className="py-1.5">
                                  {p.unmasked_count > 0
                                    ? <Badge variant="danger">{p.unmasked_count} exposed</Badge>
                                    : <Badge variant="success">all masked</Badge>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    }
                  </CardContent>
                </Card>

                {/* Hardcoded secret exposure summary */}
                <Card>
                  <CardHeader><span className="text-sm font-semibold text-gray-700">Hardcoded Secrets by Type</span></CardHeader>
                  <CardContent className="py-4">
                    {summary.secret_exposure_summary?.length === 0 || !summary.secret_exposure_summary
                      ? <p className="text-sm text-gray-400">No hardcoded secrets detected</p>
                      : (
                        <table className="w-full text-xs">
                          <thead><tr className="text-gray-400 uppercase text-left">
                            <th className="pb-2">Type</th><th className="pb-2">Workflows</th>
                          </tr></thead>
                          <tbody>
                            {summary.secret_exposure_summary?.map(s => (
                              <tr key={s.secret_type}
                                className="border-t border-gray-100 cursor-pointer hover:bg-indigo-50 transition-colors"
                                onClick={() => setSecretDrilldown(s.secret_type)}
                              >
                                <td className="py-1.5 font-medium text-indigo-700 underline decoration-dotted">{s.secret_type.replace(/_/g, ' ')}</td>
                                <td className="py-1.5"><Badge variant="danger">{s.workflow_count} affected</Badge></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )
                    }
                  </CardContent>
                </Card>
              </div>

              {/* Top risk workflows */}
              <Card>
                <CardHeader><span className="text-sm font-semibold text-gray-700">Top Risk Workflows</span></CardHeader>
                <Table>
                  <thead><tr><Th>Name</Th><Th>Risk Level</Th><Th>Score</Th><Th>Top Factors</Th></tr></thead>
                  <tbody>
                    {summary.top_risk_workflows?.length === 0 && (
                      <tr><Td colSpan={4} className="text-center text-gray-400">No scored workflows</Td></tr>
                    )}
                    {summary.top_risk_workflows?.map(w => (
                      <Tr key={w.id} onClick={() => { setSelectedId(w.id); setTab('workflows') }}>
                        <Td className="font-medium text-gray-900">{w.name}</Td>
                        <Td><Badge variant={riskVariant[w.risk_level]}>{w.risk_level}</Badge></Td>
                        <Td><RiskBar score={w.risk_score} /></Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {w.top_factors?.slice(0, 3).map(f => (
                              <span key={f} className="px-1.5 py-0 text-xs bg-red-50 text-red-600 rounded">{f}</span>
                            ))}
                          </div>
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <GitBranch size={32} className="mx-auto text-gray-300 mb-3" />
                <p className="text-sm text-gray-500">No workflow data yet.</p>
                <p className="text-xs text-gray-400 mt-1">Click <strong>Discover Workflows</strong> to pull from n8n.</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Workflows tab ── */}
      {tab === 'workflows' && (
        <Card>
          <CardHeader className="flex items-center gap-3 flex-wrap">
            {projectOptions.length > 0 && (
              <>
                <span className="text-sm font-medium text-gray-700">Project:</span>
                <Select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="w-44">
                  <option value="">All projects</option>
                  {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </>
            )}
            <span className="text-sm font-medium text-gray-700 ml-2">Platform:</span>
            <Select value={platformFilter} onChange={e => setPlatformFilter(e.target.value)} className="w-40">
              <option value="">All platforms</option>
              <option value="n8n">n8n</option>
              <option value="make">Make.com</option>
              <option value="zapier">Zapier</option>
              <option value="power_automate">Power Automate</option>
              <option value="camunda">Camunda</option>
            </Select>
            <span className="text-sm font-medium text-gray-700 ml-2">Risk:</span>
            <Select value={riskFilter} onChange={e => setRiskFilter(e.target.value)} className="w-36">
              <option value="">All levels</option>
              {['LOW','MEDIUM','HIGH','CRITICAL'].map(l => <option key={l}>{l}</option>)}
            </Select>
            <span className="text-sm font-medium text-gray-700 ml-2">Status:</span>
            <Select value={activeFilter} onChange={e => setActiveFilter(e.target.value)} className="w-32">
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </Select>
          </CardHeader>
          <Table>
            <thead><tr>
              <SortTh col="name">Name</SortTh>
              <SortTh col="platform">Platform</SortTh>
              <SortTh col="project">Project</SortTh>
              <SortTh col="risk_level">Risk Level</SortTh>
              <SortTh col="risk_score">Score</SortTh>
              <SortTh col="active">Status</SortTh>
              <SortTh col="policies_applied">Policies</SortTh>
              <SortTh col="violations">Violations</SortTh>
              <SortTh col="scored_at">Scored</SortTh>
              <Th />
            </tr></thead>
            <tbody>
              {wfLoading && <tr><Td colSpan={10} className="text-center text-gray-400">Loading…</Td></tr>}
              {sortedWorkflows.map(w => (
                <Tr key={w.id}>
                  <Td className="font-medium text-gray-900 max-w-xs truncate">{w.name}</Td>
                  <Td><PlatformChip platform={w.platform ?? 'n8n'} /></Td>
                  <Td>
                    {w.project_name
                      ? <span className="px-2 py-0.5 text-xs bg-indigo-50 text-indigo-700 rounded-full border border-indigo-100">{w.project_name}</span>
                      : <span className="text-xs text-gray-300">—</span>}
                  </Td>
                  <Td>
                    {w.risk_level
                      ? <Badge variant={riskVariant[w.risk_level]}>{w.risk_level}</Badge>
                      : <span className="text-xs text-gray-400">unscored</span>}
                  </Td>
                  <Td><RiskBar score={w.risk_score} /></Td>
                  <Td><Badge variant={w.active ? 'success' : 'default'}>{w.active ? 'active' : 'inactive'}</Badge></Td>
                  <Td>
                    {w.policies_applied
                      ? <RowPolicies workflowId={w.id} />
                      : <span className="text-xs text-gray-400">none</span>}
                  </Td>
                  <Td>
                    {(() => {
                      const vs = violationMap[w.id]
                      const open = Number(vs?.open ?? 0)
                      if (!vs) return <span className="text-xs text-gray-300">—</span>
                      return (
                        <div className="flex items-center gap-1">
                          {open > 0
                            ? <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-semibold bg-red-100 text-red-700 rounded-full">
                                <AlertTriangle size={9} />{open}
                              </span>
                            : <span className="text-xs text-green-600">✓ clear</span>
                          }
                          {Number(vs.acknowledged ?? 0) > 0 && (
                            <span className="text-xs text-yellow-600">{vs.acknowledged}ack</span>
                          )}
                        </div>
                      )
                    })()}
                  </Td>
                  <Td className="text-xs text-gray-400">
                    {w.scored_at ? new Date(w.scored_at).toLocaleDateString() : '—'}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <button
                        title="View detail"
                        onClick={() => setSelectedId(w.id)}
                        className="text-gray-400 hover:text-indigo-600 p-0.5"
                      >
                        <Eye size={14} />
                      </button>
                      <button
                        title="Re-score"
                        disabled={score.isPending}
                        onClick={() => score.mutate(w.id)}
                        className="text-gray-400 hover:text-indigo-600 p-0.5 disabled:opacity-40"
                      >
                        <RefreshCw size={14} className={score.isPending && score.variables === w.id ? 'animate-spin' : ''} />
                      </button>
                      <button
                        title="Apply policies"
                        disabled={!w.risk_level || applyPolicies.isPending}
                        onClick={() => applyPolicies.mutate(w.id)}
                        className="text-gray-400 hover:text-green-600 p-0.5 disabled:opacity-40"
                      >
                        <Shield size={14} />
                      </button>
                      <button
                        title="Evaluate policy rules"
                        disabled={!w.policies_applied || evaluate.isPending}
                        onClick={() => evaluate.mutate(w.id)}
                        className="text-gray-400 hover:text-violet-600 p-0.5 disabled:opacity-40"
                      >
                        <ShieldCheck size={14} className={evaluate.isPending && evaluate.variables === w.id ? 'animate-pulse' : ''} />
                      </button>
                      <button
                        title="AI governance analysis"
                        disabled={!w.risk_level}
                        onClick={() => setAnalyzing({ id: w.id, name: w.name })}
                        className="text-gray-400 hover:text-purple-600 p-0.5 disabled:opacity-40"
                      >
                        <Sparkles size={14} />
                      </button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {!wfLoading && workflows.length === 0 && (
                <tr><Td colSpan={10} className="text-center text-gray-400">
                  No workflows found. Run <strong>Discover Workflows</strong> or <strong>Import Workflow</strong> first.
                </Td></tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ── Node Types tab ── */}
      {tab === 'nodes' && (
        <Card>
          <Table>
            <thead><tr>
              <Th><span className="flex items-center">Governance Type<InfoTip content={help.wf.colGovernanceType} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Total Nodes<InfoTip content={help.wf.colTotalNodes} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Workflows<InfoTip content={help.wf.colWorkflows} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Common Risk Factors<InfoTip content={help.wf.colRiskFactors} side="bottom" /></span></Th>
            </tr></thead>
            <tbody>
              {nodesLoading && <tr><Td colSpan={4} className="text-center text-gray-400">Loading…</Td></tr>}
              {nodes.map(n => (
                <Tr key={n.governance_type}>
                  <Td>
                    <span className="flex items-center gap-1">
                      <Badge variant={n.governance_type === 'ai_inference' ? 'purple' : n.governance_type === 'credential' ? 'danger' : 'default'}>
                        {n.governance_type}
                      </Badge>
                      {GOV_TYPE_TIPS[n.governance_type] && (
                        <InfoTip content={GOV_TYPE_TIPS[n.governance_type]} side="right" />
                      )}
                    </span>
                  </Td>
                  <Td className="tabular-nums">{n.total_nodes}</Td>
                  <Td className="tabular-nums">{n.workflow_count}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {n.common_risk_factors?.slice(0, 4).map(f => (
                        <span key={f} className="inline-flex items-center px-1.5 py-0 text-xs bg-yellow-50 text-yellow-700 rounded">
                          {f}
                          {RISK_FACTOR_TIPS[f] && <InfoTip content={RISK_FACTOR_TIPS[f]} side="top" size={11} />}
                        </span>
                      ))}
                    </div>
                  </Td>
                </Tr>
              ))}
              {!nodesLoading && nodes.length === 0 && (
                <tr><Td colSpan={4} className="text-center text-gray-400">No node data yet</Td></tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ── By Domain tab ── */}
      {tab === 'domain' && (
        <Card>
          <Table>
            <thead><tr>
              <Th>Business Domain</Th>
              <Th>Workflows</Th>
              <Th>High/Critical Risk</Th>
              <Th>Avg Risk Score</Th>
            </tr></thead>
            <tbody>
              {byDomainLoading && <tr><Td colSpan={4} className="text-center text-gray-400">Loading…</Td></tr>}
              {byDomain.map(d => (
                <Tr key={d.business_domain}>
                  <Td className={d.business_domain === 'Unclassified' ? 'text-gray-400 italic' : 'font-medium text-gray-800'}>
                    {d.business_domain}
                  </Td>
                  <Td className="tabular-nums">{d.total_workflows}</Td>
                  <Td className="tabular-nums">{d.high_risk_workflows}</Td>
                  <Td className="tabular-nums">{d.avg_risk_score ?? '—'}</Td>
                </Tr>
              ))}
              {!byDomainLoading && byDomain.length === 0 && (
                <tr><Td colSpan={4} className="text-center text-gray-400">No workflows yet</Td></tr>
              )}
            </tbody>
          </Table>
        </Card>
      )}

      {piiDrilldown && (
        <PiiDrilldownModal
          piiType={piiDrilldown}
          onClose={() => setPiiDrilldown(null)}
          onSelectWorkflow={id => { setPiiDrilldown(null); setSelectedId(id); setTab('workflows') }}
        />
      )}
      {secretDrilldown && (
        <SecretDrilldownModal
          secretType={secretDrilldown}
          onClose={() => setSecretDrilldown(null)}
          onSelectWorkflow={id => { setSecretDrilldown(null); setSelectedId(id); setTab('workflows') }}
        />
      )}
      {selectedId && <WorkflowDetail workflowId={selectedId} onClose={() => setSelectedId(null)} />}
      {analyzing && (
        <AnalysisModal
          workflowId={analyzing.id}
          workflowName={analyzing.name}
          onClose={() => setAnalyzing(null)}
        />
      )}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => {
            qc.invalidateQueries({ queryKey: ['workflows'] })
            qc.invalidateQueries({ queryKey: ['wf-risk-summary'] })
            setTab('workflows')
          }}
        />
      )}
    </div>
  )
}
