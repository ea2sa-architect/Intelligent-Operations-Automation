import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Clock } from 'lucide-react'
import { governance } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Table, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

const STATUS_VARIANT = { pending: 'warning', approved: 'success', denied: 'danger', expired: 'default' }

// EP-104-S8 — a waiver within 3 days of expiring is worth flagging distinctly
// from one that's merely "approved and fine for now"; the reaper reopens the
// violation the moment it actually crosses expires_at, this is the earlier
// heads-up so nobody's surprised by that.
function expiryUrgency(expiresAt) {
  const days = Math.ceil((new Date(expiresAt) - Date.now()) / 86_400_000)
  if (days < 0) return { label: 'Expired', className: 'text-red-600 font-medium' }
  if (days <= 3) return { label: `${days}d left`, className: 'text-orange-600 font-medium' }
  return { label: `${days}d left`, className: 'text-gray-500' }
}

export function WaiverAdmin() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState('pending')

  const { data: waivers = [], isLoading } = useQuery({
    queryKey: ['waivers', statusFilter],
    queryFn: () => governance.listWaivers(statusFilter ? { status: statusFilter } : {}),
  })

  const decide = useMutation({
    mutationFn: ({ id, decision }) => governance.decideWaiver(id, decision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['waivers'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Clock size={18} className="text-purple-500" />
            Waivers
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Pending waiver requests and the full waiver queue, with an expiry countdown. Approving requires a
            different actor from the requester.
          </p>
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
        >
          <option value="pending">Pending Approval</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="expired">Expired</option>
          <option value="">All statuses</option>
        </select>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th>Status</Th>
            <Th>Justification</Th>
            <Th>Requested By</Th>
            <Th>Requested At</Th>
            <Th>Expires</Th>
            <Th>Approver</Th>
            <Th />
          </tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={7} className="text-center text-gray-400">Loading…</Td></tr>}
            {!isLoading && waivers.length === 0 && (
              <tr><Td colSpan={7} className="text-center text-gray-400 py-8">No waivers match this filter.</Td></tr>
            )}
            {waivers.map(w => {
              const urgency = expiryUrgency(w.expires_at)
              return (
                <Tr key={w.id}>
                  <Td><Badge variant={STATUS_VARIANT[w.status] ?? 'default'}>{w.status}</Badge></Td>
                  <Td className="max-w-xs truncate" title={w.justification}>{w.justification}</Td>
                  <Td className="text-xs text-gray-500">{w.requested_by}</Td>
                  <Td className="text-xs text-gray-400 whitespace-nowrap">{new Date(w.requested_at).toLocaleDateString()}</Td>
                  <Td className="whitespace-nowrap">
                    <div className="text-xs text-gray-600">{new Date(w.expires_at).toLocaleDateString()}</div>
                    {w.status === 'pending' || w.status === 'approved'
                      ? <div className={`text-xs ${urgency.className}`}>{urgency.label}</div>
                      : null}
                  </Td>
                  <Td className="text-xs text-gray-500">{w.approver ?? '—'}</Td>
                  <Td>
                    {w.status === 'pending' && (
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onClick={() => decide.mutate({ id: w.id, decision: 'approved' })}>Approve</Button>
                        <Button size="sm" variant="danger" onClick={() => decide.mutate({ id: w.id, decision: 'denied' })}>Deny</Button>
                      </div>
                    )}
                  </Td>
                </Tr>
              )
            })}
          </tbody>
        </Table>
        {decide.error && <p className="text-xs text-red-600 px-4 py-2">{decide.error.message}</p>}
      </Card>
    </div>
  )
}
