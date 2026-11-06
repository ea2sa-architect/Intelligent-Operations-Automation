import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, GitBranch } from 'lucide-react'
import { governance } from '../../lib/api'
import { useAuth } from '../../components/AuthGuard'
import { Card } from '../../components/ui/Card'
import { Table, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input, Label, Select } from '../../components/ui/Input'

const RISK_TIER_VARIANT = { low: 'default', moderate: 'info', high: 'warning', critical: 'danger' }
const STATUS_VARIANT    = { pending: 'warning', approved: 'success', rejected: 'danger', cancelled: 'default' }

const EXAMPLE_STAGES = JSON.stringify(
  [{ order: 1, approver_role: 'security_lead', quorum: 1 }, { order: 2, approver_role: 'admin', quorum: 2 }],
  null, 2
)

function validateStagesJson(text) {
  let parsed
  try { parsed = JSON.parse(text) } catch { return 'Not valid JSON' }
  if (!Array.isArray(parsed) || parsed.length === 0) return 'Must be a non-empty array'
  for (const s of parsed) {
    if (typeof s.order !== 'number' || s.order < 1) return 'Each stage needs a positive numeric order'
    if (!s.approver_role) return 'Each stage needs an approver_role'
    if (typeof s.quorum !== 'number' || s.quorum < 1) return 'Each stage needs a positive numeric quorum'
  }
  return null
}

// ── Chain templates ─────────────────────────────────────────────────────
function ChainTemplates() {
  const qc = useQueryClient()
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ name: '', risk_tier: 'high', execution_mode: 'sequential', stagesJson: EXAMPLE_STAGES })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))
  const stagesError = showAdd ? validateStagesJson(form.stagesJson) : null

  const { data: chains = [], isLoading } = useQuery({
    queryKey: ['approval-chains'],
    queryFn:  () => governance.listApprovalChains(),
  })

  const create = useMutation({
    mutationFn: () => governance.createApprovalChain({
      name: form.name, risk_tier: form.risk_tier, execution_mode: form.execution_mode,
      stages: JSON.parse(form.stagesJson),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['approval-chains'] })
      setShowAdd(false)
      setForm({ name: '', risk_tier: 'high', execution_mode: 'sequential', stagesJson: EXAMPLE_STAGES })
    },
  })

  const toggleStatus = useMutation({
    mutationFn: (chain) => governance.setApprovalChainStatus(chain.id, chain.status === 'active' ? 'inactive' : 'active'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approval-chains'] }),
  })

  return (
    <Card>
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">Chain Templates</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            One active chain per risk tier. Approving a server whose risk_tier matches an active chain starts it
            instead of finalizing immediately.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowAdd(v => !v)}>
          <Plus size={14} />{showAdd ? 'Cancel' : 'New Chain'}
        </Button>
      </div>

      {showAdd && (
        <div className="px-6 py-4 border-b border-gray-200 space-y-3 bg-gray-50">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label>Name</Label>
              <Input value={form.name} onChange={set('name')} placeholder="Critical MCP Approval" />
            </div>
            <div>
              <Label>Risk Tier</Label>
              <Select value={form.risk_tier} onChange={set('risk_tier')}>
                <option value="low">Low</option>
                <option value="moderate">Moderate</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </Select>
            </div>
            <div>
              <Label>Execution Mode</Label>
              <Select value={form.execution_mode} onChange={set('execution_mode')}>
                <option value="sequential">Sequential (stages in order)</option>
                <option value="parallel">Parallel (all stages at once)</option>
              </Select>
            </div>
          </div>
          <div>
            <Label>Stages (JSON array — order, approver_role, quorum)</Label>
            <textarea rows={5} value={form.stagesJson} onChange={set('stagesJson')}
              className={`w-full px-3 py-2 text-xs font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                stagesError ? 'border-red-300' : 'border-gray-300'
              }`} />
            {stagesError && <p className="text-xs text-red-600 mt-1">{stagesError}</p>}
          </div>
          <Button
            size="sm"
            disabled={!form.name || !!stagesError || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Saving…' : 'Create Chain'}
          </Button>
          {create.error && <p className="text-xs text-red-600">{create.error.message}</p>}
        </div>
      )}

      <Table>
        <thead><tr>
          <Th>Name</Th><Th>Risk Tier</Th><Th>Mode</Th><Th>Stages</Th><Th>Status</Th><Th />
        </tr></thead>
        <tbody>
          {isLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}
          {!isLoading && chains.length === 0 && (
            <tr><Td colSpan={6} className="text-center text-gray-400 py-8">No approval chains defined yet.</Td></tr>
          )}
          {chains.map(chain => (
            <Tr key={chain.id}>
              <Td className="font-medium text-gray-800">{chain.name}</Td>
              <Td><Badge variant={RISK_TIER_VARIANT[chain.risk_tier] ?? 'default'}>{chain.risk_tier}</Badge></Td>
              <Td className="text-xs text-gray-500">{chain.execution_mode}</Td>
              <Td className="text-xs text-gray-500">{chain.stages?.length ?? 0} stage(s)</Td>
              <Td><Badge variant={chain.status === 'active' ? 'success' : 'default'}>{chain.status}</Badge></Td>
              <Td>
                <Button size="sm" variant="secondary" onClick={() => toggleStatus.mutate(chain)}>
                  {chain.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}

// ── Pending requests ─────────────────────────────────────────────────────
function DecisionPanel({ request, onDone }) {
  const { user } = useAuth()
  const [reason, setReason] = useState('')
  const decide = useMutation({
    mutationFn: (decision) => governance.decideApprovalRequest(request.id, { stage_order: request.current_stage, decision, reason: reason || undefined }),
    onSuccess: onDone,
  })

  const isRequester = user?.username === request.requested_by

  return (
    <div className="space-y-2">
      {isRequester && (
        <p className="text-xs text-amber-600">You requested this — a different approver must decide it.</p>
      )}
      <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional reason" className="text-xs" />
      <div className="flex gap-2">
        <Button size="sm" variant="primary" disabled={isRequester || decide.isPending} onClick={() => decide.mutate('approved')}>
          Approve stage {request.current_stage}
        </Button>
        <Button size="sm" variant="danger" disabled={isRequester || decide.isPending} onClick={() => decide.mutate('rejected')}>
          Reject
        </Button>
      </div>
      {decide.error && <p className="text-xs text-red-600">{decide.error.message}</p>}
    </div>
  )
}

function PendingRequests() {
  const qc = useQueryClient()
  const [expandedId, setExpandedId] = useState(null)

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ['approval-chain-requests', 'pending'],
    queryFn:  () => governance.listApprovalRequests({ status: 'pending' }),
  })

  return (
    <Card>
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">Pending Approvals</h2>
        <p className="text-xs text-gray-500 mt-0.5">In-flight multi-stage approval requests, waiting on the current stage.</p>
      </div>
      <Table>
        <thead><tr>
          <Th>Chain</Th><Th>Asset</Th><Th>Stage</Th><Th>Requested By</Th><Th>Requested</Th><Th>Status</Th><Th />
        </tr></thead>
        <tbody>
          {isLoading && <tr><Td colSpan={7} className="text-center text-gray-400">Loading…</Td></tr>}
          {!isLoading && requests.length === 0 && (
            <tr><Td colSpan={7} className="text-center text-gray-400 py-8">No pending approval requests.</Td></tr>
          )}
          {requests.map(r => (
            <Fragment key={r.id}>
              <Tr onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                <Td className="font-medium text-gray-800">{r.chain_name}</Td>
                <Td className="text-xs text-gray-500">{r.asset_type} · {r.asset_id}</Td>
                <Td className="text-xs text-gray-500">stage {r.current_stage}</Td>
                <Td className="text-xs text-gray-500">{r.requested_by}</Td>
                <Td className="text-xs text-gray-400">{new Date(r.requested_at).toLocaleString()}</Td>
                <Td><Badge variant={STATUS_VARIANT[r.status] ?? 'default'}>{r.status}</Badge></Td>
                <Td className="text-xs text-indigo-500">{expandedId === r.id ? 'Hide' : 'Decide'}</Td>
              </Tr>
              {expandedId === r.id && (
                <tr key={`${r.id}-decision`} className="bg-gray-50">
                  <Td colSpan={7}>
                    <DecisionPanel request={r} onDone={() => {
                      setExpandedId(null)
                      qc.invalidateQueries({ queryKey: ['approval-chain-requests'] })
                    }} />
                  </Td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </Table>
    </Card>
  )
}

export function ApprovalChains() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <GitBranch size={18} className="text-indigo-500" />
          Approval Chains
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Multi-stage, quorum-based approval per risk tier — EP-202 Human Approval Gates.
        </p>
      </div>
      <ChainTemplates />
      <PendingRequests />
    </div>
  )
}
