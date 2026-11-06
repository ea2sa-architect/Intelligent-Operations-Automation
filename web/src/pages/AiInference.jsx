import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Copy, Check, ChevronDown, ChevronRight } from 'lucide-react'
import { inference, governance } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/ui/Card'
import { Table, Th, Td, Tr } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input, Label, Select } from '../components/ui/Input'
import { InfoTip } from '../components/ui/InfoTip'
import { help } from '../lib/helpContent'

// ── Constants ──────────────────────────────────────────────────────────────
const modelStatusVariant   = { inactive: 'default', active: 'success', deprecated: 'danger' }
const requestStatusVariant = { pending: 'warning', completed: 'success', failed: 'danger' }

const OUTCOME_META = {
  allow:  { label: 'ALLOW',  bg: 'bg-green-50',  border: 'border-green-200', text: 'text-green-800', badge: 'bg-green-100 text-green-800',  dot: 'bg-green-500' },
  deny:   { label: 'DENY',   bg: 'bg-red-50',    border: 'border-red-200',   text: 'text-red-800',   badge: 'bg-red-100 text-red-800',    dot: 'bg-red-500'   },
  review: { label: 'REVIEW', bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-800', badge: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
}

const PRESET_CONTROLS = [
  'No PII detected',
  'Approved AI provider',
  'Approved data classification',
  'Workflow risk score acceptable',
  'Model is sanctioned',
  'Output filtering configured',
  'Request authenticated',
  'Rate limit not exceeded',
]

// ── Helpers ────────────────────────────────────────────────────────────────
function outcomeMeta(outcome) {
  return OUTCOME_META[outcome?.toLowerCase()] ?? null
}

function OutcomeBadge({ outcome, size = 'md' }) {
  const m = outcomeMeta(outcome)
  if (!m) return <span className="text-xs text-gray-400">—</span>
  const sz = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm'
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-bold uppercase ${sz} ${m.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  )
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button onClick={copy} className="text-gray-300 hover:text-gray-500 transition-colors ml-1">
      {copied ? <Check size={11} className="text-green-500" /> : <Copy size={11} />}
    </button>
  )
}

// ── Decision Card — the core explainable governance component ──────────────
function DecisionCard({ decision }) {
  const [notesOpen, setNotesOpen] = useState(false)
  const r  = decision.reasoning_json ?? {}
  const m  = outcomeMeta(decision.outcome)
  const controls = r.controls ?? []
  const passCount = controls.filter(c => c.passed).length
  const failCount = controls.length - passCount

  return (
    <div className={`rounded-lg border-2 ${m ? m.border : 'border-gray-200'} ${m ? m.bg : 'bg-gray-50'} overflow-hidden`}>

      {/* Header — Decision + Confidence */}
      <div className={`px-5 py-4 flex items-start justify-between gap-4 ${m ? `border-b ${m.border}` : 'border-b border-gray-200'}`}>
        <div className="space-y-1">
          <p className={`text-xs font-semibold uppercase tracking-widest ${m ? m.text : 'text-gray-500'}`}>
            Decision
          </p>
          <OutcomeBadge outcome={decision.outcome} />
        </div>
        {decision.confidence != null && (
          <div className="text-right shrink-0">
            <p className="text-3xl font-bold text-gray-900 tabular-nums leading-none">
              {Math.round(decision.confidence * 100)}%
            </p>
            <p className="text-xs text-gray-400 mt-0.5">confidence</p>
          </div>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">

        {/* Policy Evaluated */}
        {(r.policy_name || decision.policy_id) && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">
              Policy Evaluated
            </p>
            <p className="text-sm font-semibold text-gray-800">
              {r.policy_name ?? <span className="font-mono text-xs">{decision.policy_id}</span>}
              {r.policy_version != null && (
                <span className="text-gray-400 font-normal ml-2 text-xs">v{r.policy_version}</span>
              )}
            </p>
          </div>
        )}

        {/* Control Outcomes */}
        {controls.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                Control Outcome
              </p>
              <div className="flex items-center gap-2 text-xs">
                {passCount > 0 && <span className="text-green-600 font-medium">{passCount} passed</span>}
                {failCount > 0 && <span className="text-red-600 font-medium">{failCount} failed</span>}
              </div>
            </div>
            <div className="space-y-2">
              {controls.map((c, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className={`mt-0.5 text-base leading-none font-bold shrink-0 ${c.passed ? 'text-green-600' : 'text-red-600'}`}>
                    {c.passed ? '✔' : '✗'}
                  </span>
                  <div className="min-w-0">
                    <span className="text-sm text-gray-800">{c.label}</span>
                    {c.detail && (
                      <span className="text-xs text-gray-400 ml-1.5">— {c.detail}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Notes */}
        {r.notes && (
          <div className="pt-3 border-t border-current/10">
            <button
              onClick={() => setNotesOpen(v => !v)}
              className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
            >
              {notesOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Reviewer notes
            </button>
            {notesOpen && (
              <p className="mt-2 text-xs text-gray-600 italic leading-relaxed">{r.notes}</p>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-2 border-t border-current/10">
          <span className="text-xs text-gray-400">
            {new Date(decision.created_at).toLocaleString()}
          </span>
          {decision.model_name && (
            <span className="text-xs text-gray-400">{decision.model_name}</span>
          )}
        </div>

      </div>
    </div>
  )
}

// ── Record Decision Modal ──────────────────────────────────────────────────
function RecordDecisionModal({ requestId, modelName, onClose }) {
  const qc = useQueryClient()
  const [outcome,    setOutcome]    = useState('')
  const [confidence, setConfidence] = useState(90)
  const [policyId,   setPolicyId]   = useState('')
  const [controls,   setControls]   = useState(
    PRESET_CONTROLS.map(label => ({ label, enabled: false, passed: true, detail: '' }))
  )
  const [customControls, setCustomControls] = useState([])
  const [notes,      setNotes]      = useState('')
  const [showPreview, setShowPreview] = useState(false)

  const { data: policies = [] } = useQuery({
    queryKey: ['policies-for-decision'],
    queryFn:  () => governance.listPolicies('active'),
    staleTime: 60_000,
  })
  const selectedPolicy = policies.find(p => p.id === policyId)

  const record = useMutation({
    mutationFn: () => {
      const allControls = [
        ...controls.filter(c => c.enabled),
        ...customControls.filter(c => c.label.trim()),
      ].map(c => ({ label: c.label, passed: c.passed, ...(c.detail ? { detail: c.detail } : {}) }))

      const reasoning_json = {
        ...(selectedPolicy ? { policy_name: selectedPolicy.name, policy_version: selectedPolicy.version } : {}),
        controls: allControls,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      }

      return inference.recordDecision(requestId, {
        outcome,
        confidence: confidence / 100,
        policy_id:  policyId || undefined,
        reasoning_json,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inference-request', requestId] })
      qc.invalidateQueries({ queryKey: ['requests'] })
      qc.invalidateQueries({ queryKey: ['decisions'] })
      onClose()
    },
  })

  function toggleControl(i, key, val) {
    setControls(cs => cs.map((c, idx) => idx === i ? { ...c, [key]: val } : c))
  }

  function addCustomControl() {
    setCustomControls(cs => [...cs, { label: '', enabled: true, passed: true, detail: '' }])
  }

  function updateCustom(i, key, val) {
    setCustomControls(cs => cs.map((c, idx) => idx === i ? { ...c, [key]: val } : c))
  }

  // Live preview decision object
  const previewDecision = {
    outcome,
    confidence: confidence / 100,
    policy_id:  policyId || null,
    created_at: new Date().toISOString(),
    model_name: modelName,
    reasoning_json: {
      ...(selectedPolicy ? { policy_name: selectedPolicy.name, policy_version: selectedPolicy.version } : {}),
      controls: [
        ...controls.filter(c => c.enabled),
        ...customControls.filter(c => c.label.trim()),
      ].map(c => ({ label: c.label, passed: c.passed, ...(c.detail ? { detail: c.detail } : {}) })),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    },
  }

  const canSubmit = !!outcome

  return (
    <Modal title="Record Governance Decision" onClose={onClose}>
      <div className="space-y-5">

        {/* Verdict selector */}
        <div>
          <Label>Decision *</Label>
          <div className="flex gap-2 mt-1">
            {Object.entries(OUTCOME_META).map(([key, meta]) => (
              <button key={key} type="button"
                onClick={() => setOutcome(key)}
                className={`flex-1 py-2.5 rounded-lg border-2 font-bold text-sm uppercase tracking-wide transition-all ${
                  outcome === key
                    ? `${meta.border} ${meta.bg} ${meta.text}`
                    : 'border-gray-200 bg-white text-gray-400 hover:border-gray-300'
                }`}
              >
                {meta.label}
              </button>
            ))}
          </div>
        </div>

        {/* Confidence slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label>Confidence</Label>
            <span className="text-2xl font-bold text-gray-900 tabular-nums">{confidence}%</span>
          </div>
          <input type="range" min={0} max={100} value={confidence}
            onChange={e => setConfidence(Number(e.target.value))}
            className="w-full accent-indigo-600"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-0.5">
            <span>0%</span><span>50%</span><span>100%</span>
          </div>
        </div>

        {/* Policy */}
        <div>
          <Label>Policy Evaluated</Label>
          <select value={policyId} onChange={e => setPolicyId(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white mt-1"
          >
            <option value="">— none / not applicable —</option>
            {policies.map(p => (
              <option key={p.id} value={p.id}>{p.name} v{p.version}</option>
            ))}
          </select>
        </div>

        {/* Control checklist */}
        <div>
          <Label>Controls Evaluated</Label>
          <p className="text-xs text-gray-400 mb-2">Enable controls that were checked, then mark each pass or fail.</p>

          <div className="space-y-1.5 max-h-52 overflow-y-auto pr-1">
            {controls.map((c, i) => (
              <div key={i} className={`flex items-start gap-2 p-2 rounded-md transition-colors ${c.enabled ? 'bg-gray-50' : ''}`}>
                {/* Enable toggle */}
                <input type="checkbox" checked={c.enabled} onChange={e => toggleControl(i, 'enabled', e.target.checked)}
                  className="mt-0.5 accent-indigo-600" />

                {c.enabled ? (
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      {/* Pass/Fail toggle */}
                      <button type="button" onClick={() => toggleControl(i, 'passed', !c.passed)}
                        className={`shrink-0 text-base font-bold leading-none ${c.passed ? 'text-green-600' : 'text-red-600'}`}
                      >
                        {c.passed ? '✔' : '✗'}
                      </button>
                      <span className="text-sm text-gray-800">{c.label}</span>
                    </div>
                    <input type="text" placeholder="Optional detail…" value={c.detail}
                      onChange={e => toggleControl(i, 'detail', e.target.value)}
                      className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                    />
                  </div>
                ) : (
                  <span className="text-sm text-gray-400">{c.label}</span>
                )}
              </div>
            ))}

            {/* Custom controls */}
            {customControls.map((c, i) => (
              <div key={`custom-${i}`} className="flex items-start gap-2 p-2 rounded-md bg-indigo-50">
                <button type="button" onClick={() => updateCustom(i, 'passed', !c.passed)}
                  className={`shrink-0 mt-1 text-base font-bold leading-none ${c.passed ? 'text-green-600' : 'text-red-600'}`}
                >
                  {c.passed ? '✔' : '✗'}
                </button>
                <div className="flex-1 space-y-1">
                  <input type="text" placeholder="Control label…" value={c.label}
                    onChange={e => updateCustom(i, 'label', e.target.value)}
                    className="w-full text-sm border border-gray-200 rounded px-2 py-1 bg-white"
                  />
                  <input type="text" placeholder="Optional detail…" value={c.detail}
                    onChange={e => updateCustom(i, 'detail', e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded px-2 py-1 bg-white"
                  />
                </div>
                <button type="button" onClick={() => setCustomControls(cs => cs.filter((_, idx) => idx !== i))}
                  className="text-gray-300 hover:text-red-500 mt-1 text-xs">✕</button>
              </div>
            ))}
          </div>

          <button type="button" onClick={addCustomControl}
            className="mt-2 text-xs text-indigo-600 hover:underline flex items-center gap-1"
          >
            <Plus size={11} /> Add custom control
          </button>
        </div>

        {/* Notes */}
        <div>
          <Label>Reviewer Notes</Label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Optional — additional context or reasoning…"
            className="w-full mt-1 px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Live preview */}
        <div>
          <button type="button" onClick={() => setShowPreview(v => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 select-none"
          >
            {showPreview ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            Preview decision card
          </button>
          {showPreview && outcome && (
            <div className="mt-2">
              <DecisionCard decision={previewDecision} />
            </div>
          )}
          {showPreview && !outcome && (
            <p className="mt-2 text-xs text-gray-400 italic">Select a verdict above to preview the card.</p>
          )}
        </div>

        {record.error && <p className="text-xs text-red-600">{record.error.message}</p>}

        <div className="flex items-center gap-3 pt-1">
          <Button disabled={!canSubmit || record.isPending} onClick={() => record.mutate()}>
            {record.isPending ? 'Saving…' : 'Record Decision'}
          </Button>
          <button type="button" onClick={onClose} className="text-sm text-gray-500 hover:text-gray-700">Cancel</button>
        </div>
      </div>
    </Modal>
  )
}

// ── Register Model ─────────────────────────────────────────────────────────
function RegisterModelModal({ onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', version: '', endpoint: '' })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const register = useMutation({
    mutationFn: inference.registerModel,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['models'] }); onClose() },
  })

  return (
    <Modal title="Register Model" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); register.mutate(form) }} className="space-y-4">
        <div><Label>Model Name *</Label><Input value={form.name} onChange={set('name')} required /></div>
        <div><Label>Version *</Label><Input value={form.version} onChange={set('version')} placeholder="e.g. 1.0.0" required /></div>
        <div><Label>Endpoint</Label><Input value={form.endpoint} onChange={set('endpoint')} placeholder="https://…" /></div>
        {register.error && <p className="text-sm text-red-600">{register.error.message}</p>}
        <Button type="submit" disabled={register.isPending} className="w-full justify-center">
          {register.isPending ? 'Registering…' : 'Register Model'}
        </Button>
      </form>
    </Modal>
  )
}

// ── Submit Inference ───────────────────────────────────────────────────────
function SubmitInferenceModal({ models, onClose, onCreated }) {
  const [form, setForm] = useState({ model_id: models[0]?.id ?? '', input: '{}' })
  const [jsonError, setJsonError] = useState('')

  const submit = useMutation({
    mutationFn: inference.submit,
    onSuccess: result => { onCreated(result); onClose() },
  })

  function handleSubmit(e) {
    e.preventDefault()
    setJsonError('')
    let input
    try { input = JSON.parse(form.input) } catch { setJsonError('Input is not valid JSON'); return }
    submit.mutate({ model_id: form.model_id, input })
  }

  return (
    <Modal title="Submit Inference Request" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <Label>Active Model *</Label>
          <Select value={form.model_id} onChange={e => setForm(f => ({ ...f, model_id: e.target.value }))} required>
            {models.map(m => <option key={m.id} value={m.id}>{m.name} v{m.version}</option>)}
          </Select>
          {models.length === 0 && <p className="text-xs text-red-600 mt-1">No active models available</p>}
        </div>
        <div>
          <Label>Input JSON *</Label>
          <textarea
            className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            rows={5} value={form.input}
            onChange={e => setForm(f => ({ ...f, input: e.target.value }))}
          />
          {jsonError && <p className="text-xs text-red-600">{jsonError}</p>}
        </div>
        {submit.error && <p className="text-sm text-red-600">{submit.error.message}</p>}
        <Button type="submit" disabled={submit.isPending || models.length === 0} className="w-full justify-center">
          {submit.isPending ? 'Submitting…' : 'Submit'}
        </Button>
      </form>
    </Modal>
  )
}

// ── Request Detail ─────────────────────────────────────────────────────────
function RequestDetail({ requestId, onClose }) {
  const [showDecision, setShowDecision] = useState(false)

  const { data: req, isLoading } = useQuery({
    queryKey: ['inference-request', requestId],
    queryFn:  () => inference.getRequest(requestId),
    refetchInterval: query => query.state.data?.status === 'pending' ? 3000 : false,
  })

  return (
    <>
      <Modal title="Inference Request" onClose={onClose}>
        {isLoading ? <p className="text-sm text-gray-400 py-4">Loading…</p> : (
          <div className="space-y-5">

            {/* Request metadata */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-gray-400 mb-1">Status</p>
                <Badge variant={requestStatusVariant[req.status]}>{req.status}</Badge>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Model</p>
                <p className="font-medium text-gray-800">{req.model_name ?? req.model_id.slice(0, 8) + '…'}</p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-400 mb-1">Input Hash</p>
                <p className="font-mono text-xs text-gray-500 truncate">
                  {req.input_hash}
                  <CopyButton text={req.input_hash} />
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Submitted</p>
                <p className="text-sm text-gray-700">{new Date(req.created_at).toLocaleString()}</p>
              </div>
              {req.latency_ms != null && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">Latency</p>
                  <p className="text-sm text-gray-700">{req.latency_ms} ms</p>
                </div>
              )}
            </div>

            {/* Decisions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold text-gray-500 uppercase">
                  Governance Decisions ({req.decisions?.length ?? 0})
                </h3>
                {req.status === 'pending' && (
                  <button onClick={() => setShowDecision(true)}
                    className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
                  >
                    <Plus size={12} /> Record Decision
                  </button>
                )}
              </div>

              {req.decisions?.length === 0 && (
                <div className="py-6 text-center text-sm text-gray-400 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                  No governance decision recorded yet
                </div>
              )}

              <div className="space-y-3">
                {req.decisions?.map(d => (
                  <DecisionCard key={d.id} decision={{ ...d, model_name: req.model_name }} />
                ))}
              </div>
            </div>

          </div>
        )}
      </Modal>

      {showDecision && (
        <RecordDecisionModal
          requestId={requestId}
          modelName={req?.model_name}
          onClose={() => setShowDecision(false)}
        />
      )}
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export function AiInference() {
  const qc = useQueryClient()
  const [tab,              setTab]             = useState('models')
  const [showRegister,     setShowRegister]    = useState(false)
  const [showSubmit,       setShowSubmit]      = useState(false)
  const [selectedRequest,  setSelectedRequest] = useState(null)
  const [outcomeFilter,    setOutcomeFilter]   = useState('')
  const [modelFilter,      setModelFilter]     = useState('')

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['models'],
    queryFn:  () => inference.listModels(),
  })

  const { data: activeModels = [] } = useQuery({
    queryKey: ['models', 'active'],
    queryFn:  () => inference.listModels('active'),
    enabled:  showSubmit,
  })

  const { data: requests = [], isLoading: reqLoading } = useQuery({
    queryKey: ['requests'],
    queryFn:  () => inference.listRequests({ limit: 50 }),
    enabled:  tab === 'requests',
    refetchInterval: tab === 'requests' ? 5000 : false,
  })

  const { data: allDecisions = [], isLoading: decisionsLoading } = useQuery({
    queryKey: ['decisions', outcomeFilter, modelFilter],
    queryFn:  () => inference.listDecisions({
      limit: 50,
      ...(outcomeFilter && { outcome: outcomeFilter }),
    }),
    enabled: tab === 'decisions',
  })

  // Client-side model filter (model_name comes from the enriched response)
  const decisions = modelFilter
    ? allDecisions.filter(d => d.model_name === modelFilter)
    : allDecisions

  const uniqueModels = [...new Set(allDecisions.map(d => d.model_name).filter(Boolean))]

  const setModelStatus = useMutation({
    mutationFn: ({ id, status }) => inference.setModelStatus(id, status),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['models'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            AI Inference
            <InfoTip content={help.inference.pageTitle} side="right" size={15} />
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center">
            Model registry, inference requests, and governance decisions
            <InfoTip content={help.inference.subtitle} side="bottom" />
          </p>
        </div>
        <div className="flex gap-2">
          {tab === 'requests' && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setShowSubmit(true)}>
                <Plus size={16} />Submit Request
              </Button>
              <InfoTip content={help.inference.submitRequest} side="bottom" />
            </div>
          )}
          {tab === 'models' && (
            <div className="flex items-center gap-2">
              <Button onClick={() => setShowRegister(true)}>
                <Plus size={16} />Register Model
              </Button>
              <InfoTip content={help.inference.registerModel} side="bottom" />
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {[
          { key: 'models',    label: 'Models',    tip: help.inference.modelsTab },
          { key: 'requests',  label: 'Requests',  tip: help.inference.requestsTab },
          { key: 'decisions', label: 'Decisions', tip: help.inference.decisionsTab },
        ].map(({ key, label, tip }) => (
          <button key={key} onClick={() => setTab(key)}
            className={`flex items-center px-4 py-2 text-sm capitalize transition-colors ${
              tab === key ? 'border-b-2 border-indigo-600 text-indigo-700 font-medium' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {label}
            <InfoTip content={tip} side="bottom" />
          </button>
        ))}
      </div>

      {/* ── Models tab ── */}
      {tab === 'models' && (
        <Card>
          <Table>
            <thead><tr>
              <Th><span className="flex items-center">Name<InfoTip content={help.inference.colName} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Version<InfoTip content={help.inference.colVersion} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Status<InfoTip content={help.inference.modelStatus} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Endpoint<InfoTip content={help.inference.colEndpoint} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Sanctioned<InfoTip content={help.inference.sanctioned} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Actions<InfoTip content={help.inference.colActions} side="bottom" /></span></Th>
            </tr></thead>
            <tbody>
              {modelsLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}
              {models.map(m => (
                <Tr key={m.id}>
                  <Td className="font-medium text-gray-900">{m.name}</Td>
                  <Td>{m.version}</Td>
                  <Td><Badge variant={modelStatusVariant[m.status]}>{m.status}</Badge></Td>
                  <Td className="text-xs text-gray-400 truncate max-w-xs">{m.endpoint ?? '—'}</Td>
                  <Td>
                    {m.is_sanctioned === false
                      ? <Badge variant="danger">shadow AI</Badge>
                      : m.is_sanctioned === true
                        ? <Badge variant="success">sanctioned</Badge>
                        : <span className="text-xs text-gray-400">—</span>}
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      {m.status !== 'active' && <Button size="sm" variant="secondary" onClick={() => setModelStatus.mutate({ id: m.id, status: 'active' })}>Activate</Button>}
                      {m.status === 'active' && <Button size="sm" variant="secondary" onClick={() => setModelStatus.mutate({ id: m.id, status: 'deprecated' })}>Deprecate</Button>}
                    </div>
                  </Td>
                </Tr>
              ))}
              {!modelsLoading && models.length === 0 && <tr><Td colSpan={6} className="text-center text-gray-400">No models registered</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ── Requests tab ── */}
      {tab === 'requests' && (
        <Card>
          <Table>
            <thead><tr>
              <Th><span className="flex items-center">ID<InfoTip content={help.inference.colId} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Model<InfoTip content={help.inference.colModel} side="bottom" /></span></Th>
              <Th><span className="flex items-center">Status<InfoTip content={help.inference.colStatus} side="bottom" /></span></Th>
              <Th>Decision</Th>
              <Th><span className="flex items-center">Created<InfoTip content={help.inference.colCreated} side="bottom" /></span></Th>
            </tr></thead>
            <tbody>
              {reqLoading && <tr><Td colSpan={5} className="text-center text-gray-400">Loading…</Td></tr>}
              {requests.map(r => (
                <Tr key={r.id} onClick={() => setSelectedRequest(r.id)}>
                  <Td>
                    <span className="font-mono text-xs text-gray-500">{r.id.slice(0, 8)}…</span>
                    <CopyButton text={r.id} />
                  </Td>
                  <Td className="text-sm text-gray-800 font-medium">{r.model_name ?? r.model_id.slice(0, 8) + '…'}</Td>
                  <Td><Badge variant={requestStatusVariant[r.status]}>{r.status}</Badge></Td>
                  <Td>
                    {r.latest_outcome
                      ? <OutcomeBadge outcome={r.latest_outcome} size="sm" />
                      : <span className="text-xs text-gray-400">—</span>}
                  </Td>
                  <Td className="text-sm text-gray-500">{new Date(r.created_at).toLocaleString()}</Td>
                </Tr>
              ))}
              {!reqLoading && requests.length === 0 && <tr><Td colSpan={5} className="text-center text-gray-400">No requests yet</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      {/* ── Decisions tab ── */}
      {tab === 'decisions' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Outcome:</span>
            <Select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)} className="w-36">
              <option value="">All</option>
              <option value="allow">ALLOW</option>
              <option value="deny">DENY</option>
              <option value="review">REVIEW</option>
            </Select>
            {uniqueModels.length > 1 && (
              <>
                <span className="text-sm font-medium text-gray-700 ml-2">Model:</span>
                <Select value={modelFilter} onChange={e => setModelFilter(e.target.value)} className="w-48">
                  <option value="">All models</option>
                  {uniqueModels.map(n => <option key={n} value={n}>{n}</option>)}
                </Select>
              </>
            )}
          </div>

          {/* Decision cards */}
          {decisionsLoading && (
            <p className="text-sm text-gray-400 text-center py-8">Loading…</p>
          )}
          {!decisionsLoading && decisions.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-sm text-gray-400">No decisions recorded yet.</p>
                <p className="text-xs text-gray-300 mt-1">Submit a request and record a governance decision to see it here.</p>
              </CardContent>
            </Card>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {decisions.map(d => <DecisionCard key={d.id} decision={d} />)}
          </div>
        </div>
      )}

      {showRegister   && <RegisterModelModal onClose={() => setShowRegister(false)} />}
      {showSubmit     && <SubmitInferenceModal models={activeModels} onClose={() => setShowSubmit(false)} onCreated={r => setSelectedRequest(r.id)} />}
      {selectedRequest && <RequestDetail requestId={selectedRequest} onClose={() => setSelectedRequest(null)} />}
    </div>
  )
}
