import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Gauge, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { governance } from '../../lib/api'

const MODE_VARIANT    = { observe: 'default', warn: 'warning', enforce: 'danger' }
const OUTCOME_VARIANT = { allow: 'success', warn: 'warning', block: 'danger' }

// EP-201-S11 — the four numbers that answer "is enforcement live or just
// observing": total decisions, and how many of those were actually allowed
// through clean vs. flagged vs. stopped.
function SummaryStrip({ summary, isLoading }) {
  const cards = [
    { label: 'Total Decisions', value: summary?.total,  icon: Gauge,      color: 'bg-indigo-500' },
    { label: 'Allowed',         value: summary?.allow,  icon: ShieldCheck, color: 'bg-gray-500' },
    { label: 'Warned',          value: summary?.warn,   icon: ShieldAlert, color: 'bg-yellow-500' },
    { label: 'Blocked',         value: summary?.block,  icon: ShieldX,     color: 'bg-red-500' },
  ]
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, color }) => (
        <Card key={label}>
          <CardContent className="flex items-center gap-4 py-5">
            <div className={`p-3 rounded-lg ${color}`}>
              <Icon size={20} className="text-white" />
            </div>
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
              <p className="text-2xl font-semibold text-gray-900">{isLoading ? '—' : (value ?? 0)}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// Per-policy rollup — which policies are actually generating warn/block
// decisions, and what mode they're currently in. This is the "should I flip
// this from observe to warn yet" view.
function PolicyBreakdown({ byPolicy = [] }) {
  if (byPolicy.length === 0) return null
  return (
    <Card>
      <div className="px-6 py-4 border-b border-gray-200">
        <h2 className="text-sm font-semibold text-gray-900">By Policy</h2>
      </div>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 text-left text-gray-500">
              <th className="px-6 py-3 font-medium">Policy</th>
              <th className="px-6 py-3 font-medium">Mode</th>
              <th className="px-6 py-3 font-medium">Total</th>
              <th className="px-6 py-3 font-medium">Warned</th>
              <th className="px-6 py-3 font-medium">Blocked</th>
              <th className="px-6 py-3 font-medium">Last Event</th>
            </tr>
          </thead>
          <tbody>
            {byPolicy.map(row => (
              <tr key={row.policy_id} className="border-b border-gray-100 last:border-0">
                <td className="px-6 py-3 font-medium text-gray-800">{row.policy_name}</td>
                <td className="px-6 py-3"><Badge variant={MODE_VARIANT[row.enforcement_mode] ?? 'default'}>{row.enforcement_mode}</Badge></td>
                <td className="px-6 py-3 text-gray-600">{row.total}</td>
                <td className="px-6 py-3 text-yellow-600">{row.warn}</td>
                <td className="px-6 py-3 text-red-600">{row.block}</td>
                <td className="px-6 py-3 text-gray-400 whitespace-nowrap">{row.last_event_at ? new Date(row.last_event_at).toLocaleString() : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export function Enforcement() {
  const [modeFilter,    setModeFilter]    = useState('')
  const [outcomeFilter, setOutcomeFilter] = useState('')

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['enforcement', 'summary'],
    queryFn:  governance.enforcementSummary,
  })

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ['enforcement', 'events', modeFilter, outcomeFilter],
    queryFn:  () => governance.listEnforcementEvents({
      ...(modeFilter    ? { mode: modeFilter }       : {}),
      ...(outcomeFilter ? { outcome: outcomeFilter } : {}),
    }),
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Gauge size={22} className="text-indigo-500" />
          Enforcement
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          Every decision the Policy Enforcement Control Center has made — one row per bound policy per check,
          in every mode, including Observe.
        </p>
      </div>

      <SummaryStrip summary={summary} isLoading={summaryLoading} />
      <PolicyBreakdown byPolicy={summary?.by_policy} />

      <div className="flex flex-wrap gap-3">
        <select
          value={modeFilter}
          onChange={e => setModeFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
        >
          <option value="">All modes</option>
          <option value="observe">Observe</option>
          <option value="warn">Warn</option>
          <option value="enforce">Enforce</option>
        </select>
        <select
          value={outcomeFilter}
          onChange={e => setOutcomeFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded-md px-3 py-1.5 bg-white"
        >
          <option value="">All outcomes</option>
          <option value="allow">Allow</option>
          <option value="warn">Warn</option>
          <option value="block">Block</option>
        </select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-6 py-3 font-medium">Policy</th>
                <th className="px-6 py-3 font-medium">Asset</th>
                <th className="px-6 py-3 font-medium">Mode</th>
                <th className="px-6 py-3 font-medium">Outcome</th>
                <th className="px-6 py-3 font-medium">Message</th>
                <th className="px-6 py-3 font-medium">Correlation ID</th>
                <th className="px-6 py-3 font-medium">Time</th>
              </tr>
            </thead>
            <tbody>
              {eventsLoading && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">Loading…</td></tr>
              )}
              {!eventsLoading && events.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">No enforcement events match these filters</td></tr>
              )}
              {events.map(e => (
                <tr key={e.id} className="border-b border-gray-100 last:border-0">
                  <td className="px-6 py-3 font-medium text-gray-800">{e.policy_name}</td>
                  <td className="px-6 py-3 text-gray-500">{e.asset_type} · {e.asset_id}</td>
                  <td className="px-6 py-3"><Badge variant={MODE_VARIANT[e.mode] ?? 'default'}>{e.mode}</Badge></td>
                  <td className="px-6 py-3"><Badge variant={OUTCOME_VARIANT[e.outcome] ?? 'default'}>{e.outcome}</Badge></td>
                  <td className="px-6 py-3 text-gray-600 max-w-xs truncate" title={e.message}>{e.message ?? '—'}</td>
                  <td className="px-6 py-3 text-gray-400 font-mono text-xs">{e.correlation_id ?? '—'}</td>
                  <td className="px-6 py-3 text-gray-400 whitespace-nowrap">{new Date(e.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
