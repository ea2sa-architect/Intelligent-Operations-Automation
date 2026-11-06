import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertOctagon, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Input, Label } from '../../components/ui/Input'
import { governance } from '../../lib/api'

const SEVERITY_VARIANT = { critical: 'danger', high: 'warning', medium: 'info', low: 'default' }
const STATUS_VARIANT   = {
  open: 'danger', acknowledged: 'warning', remediating: 'info', reopened: 'danger',
  waiver_requested: 'purple', waived_temporarily: 'purple', resolved: 'success',
}
const WAIVER_STATUS_VARIANT = { pending: 'warning', approved: 'success', denied: 'danger', expired: 'default' }

// EP-104-S7 — a violation can only have one meaningfully "current" waiver at
// a time; showing all of them (oldest first) makes a prior denial/expiry
// visible as context for why a new request was needed, not just the latest.
function ViolationWaiverPanel({ violationId }) {
  const { data: waivers = [], isLoading } = useQuery({
    queryKey: ['violation-waivers', violationId],
    queryFn: () => governance.listWaivers({ violation_id: violationId }),
  })

  if (isLoading) return <p className="text-xs text-gray-400 py-2">Loading waiver…</p>
  if (waivers.length === 0) return null

  return (
    <div className="space-y-2 py-2">
      {waivers.map(w => (
        <div key={w.id} className="text-xs border border-purple-200 bg-purple-50 rounded-md p-3 space-y-1">
          <div className="flex items-center gap-2">
            <Badge variant={WAIVER_STATUS_VARIANT[w.status] ?? 'default'}>{w.status}</Badge>
            <span className="text-gray-500">requested by {w.requested_by}</span>
            <span className="text-gray-400">on {new Date(w.requested_at).toLocaleDateString()}</span>
          </div>
          <p className="text-gray-700">{w.justification}</p>
          {w.compensating_controls && <p className="text-gray-500">Compensating controls: {w.compensating_controls}</p>}
          <div className="text-gray-500">
            Expires {new Date(w.expires_at).toLocaleDateString()}
            {w.approver && <> · decided by {w.approver}{w.decided_at ? ` on ${new Date(w.decided_at).toLocaleDateString()}` : ''}</>}
          </div>
        </div>
      ))}
    </div>
  )
}

// EP-103-S6 — expandable, append-only history timeline for one violation.
// changed_at ordering is oldest-first (the backend already sorts this way)
// so the timeline reads top-to-bottom as it actually happened.
function ViolationHistoryTimeline({ violationId }) {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ['violation-history', violationId],
    queryFn: () => governance.violationHistory(violationId),
  })

  if (isLoading) return <p className="text-xs text-gray-400 py-2">Loading history…</p>
  if (history.length === 0) return <p className="text-xs text-gray-400 py-2">No history recorded yet.</p>

  return (
    <div className="space-y-2 py-2">
      {history.map(h => (
        <div key={h.id} className="flex items-start gap-3 text-xs border-l-2 border-indigo-200 pl-3">
          <span className="text-gray-400 whitespace-nowrap">{new Date(h.changed_at).toLocaleString()}</span>
          <div>
            <span className="text-gray-500">{h.prev_status ?? 'created'}</span>
            <span className="text-gray-400 mx-1">→</span>
            <span className="font-medium text-gray-800">{h.new_status}</span>
            <span className="text-gray-400 mx-1">·</span>
            <span className="text-gray-600">{h.actor}</span>
            {h.policy_version != null && <span className="text-gray-400"> (policy v{h.policy_version})</span>}
            {h.reason && <p className="text-gray-500 mt-0.5">{h.reason}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// EP-104-S7 — Request Waiver form. justification and expires_at are the only
// backend-required fields; the rest are optional context an approver benefits
// from but shouldn't block submission.
function WaiverRequestModal({ violation, onClose, onSubmit, isPending, error }) {
  const [form, setForm] = useState({
    justification: '', expires_at: '', risk_acceptance: '', compensating_controls: '',
    scope: '', remediation_commitment: '', residual_risk: '',
  })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <Modal title={`Request Waiver — ${violation.policy_name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-gray-500">{violation.message}</p>
        <div>
          <Label>Justification *</Label>
          <textarea rows={3} value={form.justification} onChange={set('justification')}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
            placeholder="Why is an exception warranted here?" />
        </div>
        <div>
          <Label>Expires At *</Label>
          <Input type="date" value={form.expires_at} onChange={set('expires_at')} />
        </div>
        <div>
          <Label>Risk Acceptance</Label>
          <textarea rows={2} value={form.risk_acceptance} onChange={set('risk_acceptance')}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <Label>Compensating Controls</Label>
          <textarea rows={2} value={form.compensating_controls} onChange={set('compensating_controls')}
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        </div>
        <div>
          <Label>Remediation Commitment</Label>
          <Input value={form.remediation_commitment} onChange={set('remediation_commitment')} placeholder="What will change before this expires?" />
        </div>
        {error && <p className="text-xs text-red-600">{error.message}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!form.justification || !form.expires_at || isPending}
            onClick={() => onSubmit({
              ...form,
              expires_at: new Date(form.expires_at).toISOString(),
            })}
          >
            {isPending ? 'Submitting…' : 'Submit Request'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function Violations() {
  const qc = useQueryClient()
  const [statusFilter,   setStatusFilter]   = useState('')
  const [severityFilter, setSeverityFilter] = useState('')
  const [expandedId, setExpandedId] = useState(null)
  const [waiverTarget, setWaiverTarget] = useState(null)

  const { data: violations = [], isLoading } = useQuery({
    queryKey: ['violations', statusFilter, severityFilter],
    queryFn: () => governance.listViolations({
      ...(statusFilter   ? { status: statusFilter }     : {}),
      ...(severityFilter ? { severity: severityFilter } : {}),
    }),
  })

  function invalidate() {
    qc.invalidateQueries({ queryKey: ['violations'] })
    qc.invalidateQueries({ queryKey: ['violation-history'] })
    qc.invalidateQueries({ queryKey: ['violation-waivers'] })
  }

  const acknowledge  = useMutation({ mutationFn: governance.acknowledgeViolation,  onSuccess: invalidate })
  const remediate    = useMutation({ mutationFn: governance.markRemediating,       onSuccess: invalidate })
  const resolve      = useMutation({ mutationFn: id => governance.resolveViolationWithReason(id), onSuccess: invalidate })
  const requestWaiver = useMutation({
    mutationFn: ({ id, body }) => governance.requestWaiver(id, body),
    onSuccess: () => { invalidate(); setWaiverTarget(null) },
  })

  const ACTIONABLE = ['open', 'acknowledged', 'remediating', 'reopened']

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <AlertOctagon size={22} className="text-red-500" />
          Violations
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Runtime findings from policy rule evaluation against workflows — part of the Governance pillar.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
        >
          <option value="">All statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="remediating">Remediating</option>
          <option value="waiver_requested">Waiver Requested</option>
          <option value="waived_temporarily">Waived (Temporary)</option>
          <option value="reopened">Reopened</option>
          <option value="resolved">Resolved</option>
        </select>
        <select
          value={severityFilter}
          onChange={e => setSeverityFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
        >
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-6 py-3 font-medium w-8"></th>
                <th className="px-6 py-3 font-medium">Policy</th>
                <th className="px-6 py-3 font-medium">Workflow</th>
                <th className="px-6 py-3 font-medium">Severity</th>
                <th className="px-6 py-3 font-medium">Status</th>
                <th className="px-6 py-3 font-medium">Message</th>
                <th className="px-6 py-3 font-medium">Detected</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && violations.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-gray-400">No violations match these filters</td></tr>
              )}
              {violations.map(v => (
                <Fragment key={v.id}>
                  <tr className="border-b border-gray-100 last:border-0 cursor-pointer hover:bg-gray-50"
                    onClick={() => setExpandedId(expandedId === v.id ? null : v.id)}>
                    <td className="px-6 py-3 text-gray-400">
                      {expandedId === v.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </td>
                    <td className="px-6 py-3 font-medium text-gray-800">{v.policy_name}</td>
                    <td className="px-6 py-3 text-gray-500">{v.workflow_id}</td>
                    <td className="px-6 py-3"><Badge variant={SEVERITY_VARIANT[v.severity] ?? 'default'}>{v.severity}</Badge></td>
                    <td className="px-6 py-3"><Badge variant={STATUS_VARIANT[v.status] ?? 'default'}>{v.status}</Badge></td>
                    <td className="px-6 py-3 text-gray-600 max-w-xs truncate" title={v.message}>{v.message}</td>
                    <td className="px-6 py-3 text-gray-400 whitespace-nowrap">{new Date(v.detected_at).toLocaleDateString()}</td>
                    <td className="px-6 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex flex-wrap gap-2">
                        {v.status === 'open' && (
                          <Button size="sm" variant="secondary" onClick={() => acknowledge.mutate(v.id)}>Acknowledge</Button>
                        )}
                        {v.status === 'acknowledged' && (
                          <Button size="sm" variant="secondary" onClick={() => remediate.mutate(v.id)}>Start Remediation</Button>
                        )}
                        {ACTIONABLE.includes(v.status) && (
                          <>
                            <Button size="sm" variant="primary" onClick={() => resolve.mutate(v.id)}>Resolve</Button>
                            <Button size="sm" variant="secondary" onClick={() => setWaiverTarget(v)}>Request Waiver</Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {expandedId === v.id && (
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <td className="px-6 py-2"></td>
                      <td colSpan={7} className="px-6 py-2">
                        <ViolationWaiverPanel violationId={v.id} />
                        <ViolationHistoryTimeline violationId={v.id} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {waiverTarget && (
        <WaiverRequestModal
          violation={waiverTarget}
          onClose={() => setWaiverTarget(null)}
          onSubmit={body => requestWaiver.mutate({ id: waiverTarget.id, body })}
          isPending={requestWaiver.isPending}
          error={requestWaiver.error}
        />
      )}
    </div>
  )
}
