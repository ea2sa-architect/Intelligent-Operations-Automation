import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, ShieldAlert, ShieldX, ShieldCheck, RotateCcw } from 'lucide-react'
import { escalation, governance } from '../lib/api'
import { Card, CardHeader } from '../components/ui/Card'
import { Table, Th, Td, Tr } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input, Label, Select } from '../components/ui/Input'
import { useConfirm } from '../hooks/useConfirm.jsx'

const severityVariant = { low: 'info', medium: 'warning', high: 'danger', critical: 'purple' }
const statusVariant   = { open: 'danger', acknowledged: 'warning', resolved: 'success', closed: 'default' }

const TRANSITIONS = {
  open: ['acknowledged', 'resolved', 'closed'],
  acknowledged: ['resolved', 'closed'],
  resolved: ['closed'],
  closed: [],
}

// ── Shared Rule Form ───────────────────────────────────────────────────────
function RuleForm({ initial = {}, onSubmit, loading, submitLabel }) {
  const [form, setForm] = useState({
    name:           initial.name           ?? '',
    severity:       initial.severity       ?? 'medium',
    condition_json: initial.condition_json ? JSON.stringify(initial.condition_json, null, 2) : '{}',
    channels_json:  initial.channels_json  ? JSON.stringify(initial.channels_json,  null, 2) : '[]',
    enabled:        initial.enabled        ?? true,
  })
  const [errors, setErrors] = useState({})
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  function handleSubmit(e) {
    e.preventDefault()
    const errs = {}
    let condition_json, channels_json
    try { condition_json = JSON.parse(form.condition_json) } catch { errs.condition = 'Not valid JSON' }
    try { channels_json  = JSON.parse(form.channels_json)  } catch { errs.channels  = 'Not valid JSON' }
    if (Object.keys(errs).length) { setErrors(errs); return }
    setErrors({})
    onSubmit({ name: form.name, severity: form.severity, condition_json, channels_json, enabled: form.enabled })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2"><Label>Name *</Label><Input value={form.name} onChange={set('name')} required /></div>
        <div>
          <Label>Severity</Label>
          <Select value={form.severity} onChange={set('severity')}>
            {['low','medium','high','critical'].map(s => <option key={s}>{s}</option>)}
          </Select>
        </div>
        <div>
          <Label>Enabled</Label>
          <Select value={String(form.enabled)} onChange={e => setForm(f => ({ ...f, enabled: e.target.value === 'true' }))}>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        </div>
      </div>
      <div>
        <Label>Condition JSON *</Label>
        <textarea className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          rows={3} value={form.condition_json} onChange={set('condition_json')} />
        {errors.condition && <p className="text-xs text-red-600">{errors.condition}</p>}
      </div>
      <div>
        <Label>Channels JSON (array)</Label>
        <textarea className="w-full px-3 py-2 text-xs font-mono border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
          rows={2} value={form.channels_json} onChange={set('channels_json')} placeholder='[{"type":"email","address":"ops@example.com"}]' />
        {errors.channels && <p className="text-xs text-red-600">{errors.channels}</p>}
      </div>
      <Button type="submit" disabled={loading} className="w-full justify-center">
        {loading ? 'Saving…' : submitLabel}
      </Button>
    </form>
  )
}

const containmentStateVariant = { active: 'success', suspended: 'warning', quarantined: 'danger', read_only: 'default' }

// EP-203-S6 — incidents created by this platform's own reapers/detectors
// (expiry-reminder-reaper.js, materiality-drift detection) carry the
// asset's id in context_json under a type-specific key. Incidents with no
// recognizable asset (e.g. a manually-triggered one with no context_json)
// get no containment panel — there's nothing to act on.
function resolveAssetFromIncident(incident) {
  const ctx = incident.context_json
  if (!ctx) return null
  if (ctx.server_id)   return { assetType: 'mcp_server', assetId: ctx.server_id }
  if (ctx.tool_id)     return { assetType: 'mcp_tool',    assetId: ctx.tool_id }
  if (ctx.workflow_id) return { assetType: 'workflow',    assetId: ctx.workflow_id }
  return null
}

// EP-203-S6/S7 — inline Suspend / Quarantine / Restore / Rollback actions on
// an incident, with a reason-field confirmation step before anything fires.
function ContainmentPanel({ assetType, assetId }) {
  const qc = useQueryClient()
  const [pendingAction, setPendingAction] = useState(null) // 'suspend' | 'quarantine' | 'restore' | 'rollback' | null
  const [reason, setReason] = useState('')

  const { data } = useQuery({
    queryKey: ['containment', assetType, assetId],
    queryFn: () => governance.getContainment(assetType, assetId),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: ['containment', assetType, assetId] })

  const suspend    = useMutation({ mutationFn: () => governance.suspendAsset(assetType, assetId, reason),    onSuccess: () => { invalidate(); setPendingAction(null); setReason('') } })
  const quarantine = useMutation({ mutationFn: () => governance.quarantineAsset(assetType, assetId, reason), onSuccess: () => { invalidate(); setPendingAction(null); setReason('') } })
  const restore    = useMutation({ mutationFn: () => governance.restoreAsset(assetType, assetId, reason),    onSuccess: () => { invalidate(); setPendingAction(null); setReason('') } })
  const rollback   = useMutation({ mutationFn: () => governance.rollbackAsset(assetType, assetId, reason),   onSuccess: () => { invalidate(); setPendingAction(null); setReason('') } })
  const mutations = { suspend, quarantine, restore, rollback }
  const active = pendingAction ? mutations[pendingAction] : null

  const state = data?.containment_state ?? 'active'

  return (
    <div className="bg-gray-50 rounded-lg p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase">Containment — {assetType} · {assetId}</h3>
        <Badge variant={containmentStateVariant[state] ?? 'default'}>{state}</Badge>
      </div>

      {!pendingAction ? (
        <div className="flex flex-wrap gap-2">
          {state !== 'suspended' && (
            <Button size="sm" variant="secondary" onClick={() => setPendingAction('suspend')}>
              <ShieldAlert size={13} />Suspend
            </Button>
          )}
          {state !== 'quarantined' && (
            <Button size="sm" variant="danger" onClick={() => setPendingAction('quarantine')}>
              <ShieldX size={13} />Quarantine
            </Button>
          )}
          {state !== 'active' && (
            <Button size="sm" variant="secondary" onClick={() => setPendingAction('restore')}>
              <ShieldCheck size={13} />Restore
            </Button>
          )}
          {assetType === 'mcp_tool' && (
            <Button size="sm" variant="secondary" onClick={() => setPendingAction('rollback')}>
              <RotateCcw size={13} />Rollback
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-gray-600">
            {pendingAction === 'restore'
              ? 'Restore this asset to active — it will resume receiving traffic.'
              : pendingAction === 'rollback'
              ? 'Restore the previous definition snapshot and require re-review.'
              : `${pendingAction[0].toUpperCase()}${pendingAction.slice(1)} this asset — it will stop receiving traffic immediately.`}
          </p>
          <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Reason (required for suspend/quarantine)" />
          {active?.error && <p className="text-xs text-red-600">{active.error.message}</p>}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={pendingAction === 'quarantine' ? 'danger' : 'primary'}
              disabled={active?.isPending || (['suspend', 'quarantine'].includes(pendingAction) && !reason)}
              onClick={() => active.mutate()}
            >
              {active?.isPending ? 'Working…' : `Confirm ${pendingAction}`}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { setPendingAction(null); setReason('') }}>Cancel</Button>
          </div>
        </div>
      )}

      {data?.log?.length > 0 && (
        <div className="pt-2 border-t border-gray-200 space-y-1">
          {data.log.slice(0, 5).map(entry => (
            <div key={entry.id} className="text-xs text-gray-500 flex items-center justify-between">
              <span>{entry.action} · {entry.actor}{entry.reason ? ` — ${entry.reason}` : ''}</span>
              <span className="text-gray-400">{new Date(entry.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Incident Detail ────────────────────────────────────────────────────────
function IncidentDetail({ incident: init, onClose }) {
  const qc = useQueryClient()
  const { data: incident = init } = useQuery({
    queryKey: ['incident', init.id],
    queryFn: () => escalation.getIncident(init.id),
  })

  const transition = useMutation({
    mutationFn: ({ id, status }) => escalation.transitionStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incident', init.id] })
      qc.invalidateQueries({ queryKey: ['incidents'] })
    },
  })

  const allowed = TRANSITIONS[incident.status] ?? []
  const asset = resolveAssetFromIncident(incident)

  return (
    <Modal title={incident.title} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant={severityVariant[incident.severity]}>{incident.severity}</Badge>
          <Badge variant={statusVariant[incident.status]}>{incident.status}</Badge>
          {allowed.map(s => (
            <Button key={s} size="sm" variant="secondary"
              disabled={transition.isPending}
              onClick={() => transition.mutate({ id: incident.id, status: s })}>
              → {s}
            </Button>
          ))}
        </div>
        <p className="text-xs text-gray-400">Triggered {new Date(incident.triggered_at).toLocaleString()}</p>

        {asset && <ContainmentPanel assetType={asset.assetType} assetId={asset.assetId} />}

        <div>
          <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Notification Log ({incident.log?.length ?? 0})</h3>
          {incident.log?.length === 0 && <p className="text-sm text-gray-400">No notifications sent</p>}
          {incident.log?.map(entry => (
            <div key={entry.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 text-sm">
              <span className="text-gray-700">{entry.channel} → {entry.recipient}</span>
              <Badge variant={entry.status === 'sent' ? 'success' : 'danger'}>{entry.status}</Badge>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export function Escalation() {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [tab, setTab]               = useState('incidents')
  const [showTrigger, setShowTrigger] = useState(false)
  const [showCreateRule, setShowCreateRule] = useState(false)
  const [editingRule, setEditingRule]       = useState(null)
  const [selectedIncident, setSelectedIncident] = useState(null)
  const [statusFilter, setStatusFilter] = useState('')

  const { data: incidents = [], isLoading: incLoading } = useQuery({
    queryKey: ['incidents', statusFilter],
    queryFn: () => escalation.listIncidents(statusFilter ? { status: statusFilter } : {}),
    enabled: tab === 'incidents',
  })

  const { data: rules = [], isLoading: rulesLoading } = useQuery({
    queryKey: ['rules'], queryFn: () => escalation.listRules({}),
    enabled: tab === 'rules',
  })

  const trigger = useMutation({
    mutationFn: escalation.triggerIncident,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['incidents'] }); setShowTrigger(false) },
  })

  const createRule = useMutation({
    mutationFn: escalation.createRule,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setShowCreateRule(false) },
  })

  const updateRule = useMutation({
    mutationFn: body => escalation.updateRule(editingRule.id, body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rules'] }); setEditingRule(null) },
  })

  const deleteRule = useMutation({
    mutationFn: escalation.deleteRule,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Escalation</h1>
          <p className="text-sm text-gray-500 mt-1">Incident management and escalation rules</p>
        </div>
        <div className="flex gap-2">
          {tab === 'incidents' && <Button onClick={() => setShowTrigger(true)}><Plus size={16} />Trigger Incident</Button>}
          {tab === 'rules'     && <Button onClick={() => setShowCreateRule(true)}><Plus size={16} />New Rule</Button>}
        </div>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {['incidents','rules'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'incidents' && (
        <Card>
          <CardHeader className="flex items-center gap-3">
            <span className="text-sm font-medium text-gray-700">Status:</span>
            <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-40">
              <option value="">All</option>
              {['open','acknowledged','resolved','closed'].map(s => <option key={s}>{s}</option>)}
            </Select>
          </CardHeader>
          <Table>
            <thead><tr><Th>Title</Th><Th>Severity</Th><Th>Status</Th><Th>Triggered</Th></tr></thead>
            <tbody>
              {incLoading && <tr><Td colSpan={4} className="text-center text-gray-400">Loading…</Td></tr>}
              {incidents.map(i => (
                <Tr key={i.id} onClick={() => setSelectedIncident(i)}>
                  <Td className="font-medium text-gray-900">{i.title}</Td>
                  <Td><Badge variant={severityVariant[i.severity]}>{i.severity}</Badge></Td>
                  <Td><Badge variant={statusVariant[i.status]}>{i.status}</Badge></Td>
                  <Td className="text-sm text-gray-500">{new Date(i.triggered_at).toLocaleString()}</Td>
                </Tr>
              ))}
              {!incLoading && incidents.length === 0 && <tr><Td colSpan={4} className="text-center text-gray-400">No incidents</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      {tab === 'rules' && (
        <Card>
          <Table>
            <thead><tr><Th>Name</Th><Th>Severity</Th><Th>Enabled</Th><Th /></tr></thead>
            <tbody>
              {rulesLoading && <tr><Td colSpan={4} className="text-center text-gray-400">Loading…</Td></tr>}
              {rules.map(r => (
                <Tr key={r.id}>
                  <Td className="font-medium text-gray-900">{r.name}</Td>
                  <Td><Badge variant={severityVariant[r.severity]}>{r.severity}</Badge></Td>
                  <Td><Badge variant={r.enabled ? 'success' : 'default'}>{r.enabled ? 'enabled' : 'disabled'}</Badge></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <button onClick={() => setEditingRule(r)} className="text-gray-400 hover:text-indigo-600"><Pencil size={15} /></button>
                      <button
                        onClick={async () => {
                          const ok = await confirm({ title: 'Delete Rule', message: `Delete the "${r.name}" escalation rule?`, confirmLabel: 'Delete Rule' })
                          if (ok) deleteRule.mutate(r.id)
                        }}
                        className="text-gray-400 hover:text-red-500"
                      ><Trash2 size={15} /></button>
                    </div>
                  </Td>
                </Tr>
              ))}
              {!rulesLoading && rules.length === 0 && <tr><Td colSpan={4} className="text-center text-gray-400">No rules</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      {/* Trigger incident */}
      {showTrigger && (
        <Modal title="Trigger Incident" onClose={() => setShowTrigger(false)}>
          <form onSubmit={e => { e.preventDefault(); const fd = new FormData(e.target); trigger.mutate({ title: fd.get('title'), severity: fd.get('severity') }) }}
            className="space-y-4">
            <div><Label>Title *</Label><Input name="title" required /></div>
            <div><Label>Severity</Label>
              <Select name="severity" defaultValue="medium">
                {['low','medium','high','critical'].map(s => <option key={s}>{s}</option>)}
              </Select>
            </div>
            {trigger.error && <p className="text-sm text-red-600">{trigger.error.message}</p>}
            <Button type="submit" disabled={trigger.isPending} className="w-full justify-center">
              {trigger.isPending ? 'Triggering…' : 'Trigger Incident'}
            </Button>
          </form>
        </Modal>
      )}

      {showCreateRule && (
        <Modal title="New Escalation Rule" onClose={() => setShowCreateRule(false)}>
          <RuleForm onSubmit={createRule.mutate} loading={createRule.isPending} submitLabel="Create Rule" />
          {createRule.error && <p className="text-sm text-red-600 mt-2">{createRule.error.message}</p>}
        </Modal>
      )}

      {editingRule && (
        <Modal title="Edit Rule" onClose={() => setEditingRule(null)}>
          <RuleForm initial={editingRule} onSubmit={updateRule.mutate} loading={updateRule.isPending} submitLabel="Save Changes" />
          {updateRule.error && <p className="text-sm text-red-600 mt-2">{updateRule.error.message}</p>}
        </Modal>
      )}

      {selectedIncident && <IncidentDetail incident={selectedIncident} onClose={() => setSelectedIncident(null)} />}
      {dialog}
    </div>
  )
}
