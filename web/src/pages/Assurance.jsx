import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck, Plus, Server, Database, Activity, Box, RefreshCw } from 'lucide-react'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input, Select, Label } from '../components/ui/Input'
import { workflowGovernance, assurance } from '../lib/api'

const EVIDENCE_TYPES = [
  'workflow_export_verified', 'database_backup_verified', 'restore_test_passed',
  'credential_recovery_verified', 'runbook_available', 'manual_fallback_tested',
  'dependency_backup_verified',
]
const STATUSES = ['verified', 'stale', 'failed', 'not_applicable']
const STATUS_VARIANT = { verified: 'success', stale: 'warning', failed: 'danger', not_applicable: 'default' }

const CONFIDENCE_VARIANT = {
  self_attested:          'default',
  system_collected:       'info',
  control_tested:         'purple',
  independently_verified: 'success',
}

const PLATFORM_META = {
  api_gateway_health:  { label: 'API Gateway', icon: Server },
  database_health:     { label: 'Database',    icon: Database },
  n8n_platform_health: { label: 'n8n Platform', icon: Activity },
  container_health:    { label: 'Containers',  icon: Box },
}

function isExpired(e) { return e.expires_at && new Date(e.expires_at) < new Date() }

function ConfidenceBadge({ level }) {
  if (!level) return null
  const label = level.replace(/_/g, ' ')
  return <Badge variant={CONFIDENCE_VARIANT[level] ?? 'default'}>{label}</Badge>
}

function PlatformHealthPanel() {
  const qc = useQueryClient()
  const { data: checks = [], isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['assurance-platform'],
    queryFn:  () => assurance.listPlatform(),
    refetchInterval: 5 * 60 * 1000,
  })

  const allTypes = Object.keys(PLATFORM_META)
  const checkMap = Object.fromEntries(checks.map(c => [c.evidence_type, c]))

  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Platform Health</h2>
          <div className="flex items-center gap-2">
            {dataUpdatedAt > 0 && (
              <span className="text-xs text-gray-400">
                Last sweep {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            )}
            <button
              onClick={() => qc.invalidateQueries({ queryKey: ['assurance-platform'] })}
              className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-gray-400">Loading platform checks…</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {allTypes.map(type => {
              const meta  = PLATFORM_META[type]
              const check = checkMap[type]
              const Icon  = meta.icon
              const expired = check ? isExpired(check) : false
              const statusKey = expired ? 'stale' : (check?.status ?? 'unknown')
              const variant   = STATUS_VARIANT[statusKey] ?? 'default'

              return (
                <div key={type} className="border border-gray-100 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2 text-gray-700">
                    <Icon size={15} className="shrink-0" />
                    <span className="text-xs font-medium">{meta.label}</span>
                  </div>
                  <div>
                    <Badge variant={variant}>
                      {expired ? 'stale' : (check ? statusKey : 'never collected')}
                    </Badge>
                  </div>
                  {check && (
                    <div className="text-xs text-gray-400 space-y-0.5">
                      {check.evidence?.service_count  != null && <div>{check.evidence.service_count} services</div>}
                      {check.evidence?.migration_count != null && <div>{check.evidence.migration_count} migrations</div>}
                      {check.evidence?.active_workflows != null && (
                        <div>{check.evidence.active_workflows}/{check.evidence.total_workflows} active</div>
                      )}
                      {check.evidence?.error && (
                        <div className="text-red-400 truncate" title={check.evidence.error}>
                          {check.evidence.error}
                        </div>
                      )}
                      <div className="text-gray-300">
                        {check.collected_at
                          ? new Date(check.collected_at).toLocaleTimeString()
                          : new Date(check.observed_at).toLocaleTimeString()}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
        <p className="text-xs text-gray-400">Collected automatically every 5 min by workflow-governance-service.</p>
      </CardContent>
    </Card>
  )
}

function EvidenceForm({ workflowId, onSaved }) {
  const [evidenceType, setEvidenceType] = useState(EVIDENCE_TYPES[0])
  const [status,       setStatus]       = useState('verified')
  const [expiresAt,    setExpiresAt]    = useState('')
  const [verifiedBy,   setVerifiedBy]   = useState('')

  const save = useMutation({
    mutationFn: () => assurance.record({
      workflow_id:    workflowId,
      evidence_type:  evidenceType,
      status,
      observed_at:    new Date().toISOString(),
      expires_at:     expiresAt || null,
      verified_by:    verifiedBy,
      confidence_level: 'self_attested',
    }),
    onSuccess: () => { setVerifiedBy(''); setExpiresAt(''); onSaved() },
  })

  return (
    <Card>
      <CardContent className="space-y-3">
        <h3 className="text-sm font-semibold text-gray-800">Record evidence</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Evidence type</Label>
            <Select value={evidenceType} onChange={e => setEvidenceType(e.target.value)}>
              {EVIDENCE_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>)}
            </Select>
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </Select>
          </div>
          <div>
            <Label>Expires (optional)</Label>
            <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </div>
          <div>
            <Label>Verified by</Label>
            <Input placeholder="you@company.com" value={verifiedBy} onChange={e => setVerifiedBy(e.target.value)} />
          </div>
        </div>
        <Button size="sm" onClick={() => save.mutate()} disabled={!verifiedBy || save.isPending}>
          <Plus size={14} /> Record
        </Button>
      </CardContent>
    </Card>
  )
}

export function Assurance() {
  const qc = useQueryClient()
  const [workflowId, setWorkflowId] = useState('')

  const { data: workflows = [] } = useQuery({
    queryKey: ['assurance-workflow-picker'],
    queryFn:  () => workflowGovernance.listWorkflows({ limit: 200 }),
  })
  const { data: evidence = [], isLoading } = useQuery({
    queryKey: ['assurance-evidence', workflowId],
    queryFn:  () => assurance.list(workflowId),
    enabled:  !!workflowId,
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <ShieldCheck size={22} className="text-indigo-500" />
          Assurance
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Recoverability evidence for every automation — backup, export, restore-test, and runbook attestations.
          Platform health is collected automatically.
        </p>
      </div>

      <PlatformHealthPanel />

      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Workflow Evidence</h2>
        <Select value={workflowId} onChange={e => setWorkflowId(e.target.value)} className="max-w-md">
          <option value="">Select a workflow…</option>
          {workflows.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
      </div>

      {workflowId && (
        <div className="space-y-4">
          <EvidenceForm
            workflowId={workflowId}
            onSaved={() => qc.invalidateQueries({ queryKey: ['assurance-evidence', workflowId] })}
          />

          <Card>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-gray-500">
                    <th className="px-6 py-3 font-medium">Evidence Type</th>
                    <th className="px-6 py-3 font-medium">Status</th>
                    <th className="px-6 py-3 font-medium">Confidence</th>
                    <th className="px-6 py-3 font-medium">Observed</th>
                    <th className="px-6 py-3 font-medium">Expires</th>
                    <th className="px-6 py-3 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading && <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">Loading…</td></tr>}
                  {!isLoading && evidence.length === 0 && (
                    <tr><td colSpan={6} className="px-6 py-8 text-center text-gray-400">No evidence recorded yet</td></tr>
                  )}
                  {evidence.map(e => (
                    <tr key={e.id} className="border-b border-gray-100 last:border-0">
                      <td className="px-6 py-3 text-gray-800">{e.evidence_type.replace(/_/g, ' ')}</td>
                      <td className="px-6 py-3">
                        <Badge variant={isExpired(e) ? 'danger' : (STATUS_VARIANT[e.status] ?? 'default')}>
                          {isExpired(e) ? 'expired' : e.status}
                        </Badge>
                      </td>
                      <td className="px-6 py-3">
                        <ConfidenceBadge level={e.confidence_level} />
                      </td>
                      <td className="px-6 py-3 text-gray-500">{new Date(e.observed_at).toLocaleDateString()}</td>
                      <td className="px-6 py-3 text-gray-500">{e.expires_at ? new Date(e.expires_at).toLocaleDateString() : '—'}</td>
                      <td className="px-6 py-3 text-gray-500">{e.collected_by ?? e.verified_by}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
