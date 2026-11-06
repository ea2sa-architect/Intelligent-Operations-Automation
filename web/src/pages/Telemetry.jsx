import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { telemetry, budgets as budgetsApi } from '../lib/api'
import { Card, CardHeader, CardContent } from '../components/ui/Card'
import { Table, Th, Td, Tr } from '../components/ui/Table'
import { Input, Label, Select } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts'

const COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4']

function SummaryCards({ data }) {
  if (!data?.length) return <p className="text-sm text-gray-400">No summary data available</p>
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      {data.map((row, i) => (
        <Card key={i}>
          <CardContent className="py-4">
            <p className="text-xs text-gray-500 uppercase tracking-wide">{row.service_name} · {row.metric_name}</p>
            <div className="flex gap-4 mt-2">
              <div><p className="text-xs text-gray-400">avg</p><p className="text-lg font-semibold text-gray-800">{row.avg}</p></div>
              <div><p className="text-xs text-gray-400">min</p><p className="text-lg font-semibold text-green-600">{row.min}</p></div>
              <div><p className="text-xs text-gray-400">max</p><p className="text-lg font-semibold text-red-500">{row.max}</p></div>
            </div>
            <p className="text-xs text-gray-400 mt-1">{row.samples} samples</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// EP-311-E1-S1.5 — active budgets' limit_usd overlaid as reference lines
// on the estimated_cost_usd chart only (a dollar figure; meaningless on
// the token-count charts). No attempt to match a scope-specific budget to
// one chart series — out of scope for this SHOULD story (s1.5-story.md).
function MetricsChart({ data, budgets = [] }) {
  if (!data?.length) return null

  // Group by metric_name, series per service
  const metricNames = [...new Set(data.map(d => d.metric_name))]

  return (
    <div className="space-y-6">
      {metricNames.map(metric => {
        const points = data
          .filter(d => d.metric_name === metric)
          .map(d => ({ time: new Date(d.time).toLocaleTimeString(), value: d.value, service: d.service_name }))

        const services = [...new Set(points.map(p => p.service))]

        // pivot: [{time, [service]: value}]
        const pivoted = Object.values(
          points.reduce((acc, p) => {
            if (!acc[p.time]) acc[p.time] = { time: p.time }
            acc[p.time][p.service] = p.value
            return acc
          }, {})
        )

        return (
          <Card key={metric}>
            <CardHeader><p className="text-sm font-medium text-gray-700">{metric}</p></CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={pivoted}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    {...(metric === 'estimated_cost_usd' && budgets.length > 0
                      ? { domain: [0, dataMax => Math.max(dataMax, ...budgets.map(b => Number(b.limit_usd))) * 1.1] }
                      : {})}
                  />
                  <Tooltip />
                  <Legend />
                  {services.map((svc, i) => (
                    <Line key={svc} type="monotone" dataKey={svc} stroke={COLORS[i % COLORS.length]} dot={false} strokeWidth={2} />
                  ))}
                  {metric === 'estimated_cost_usd' && budgets.map(b => (
                    <ReferenceLine
                      key={b.id}
                      y={Number(b.limit_usd)}
                      stroke={b.mode === 'hard' ? '#dc2626' : '#f59e0b'}
                      strokeDasharray="4 4"
                      label={{ value: `${b.scope_type}=${b.scope_value} (${b.mode})`, fontSize: 10, position: 'insideTopRight' }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// EP-102-S8 — correlation-chain drill-down: everything recorded under one
// correlation_id, in the order it actually happened (a workflow execution,
// the MCP tool invocations it triggered, the model inference behind one of
// those tools — whatever shares the id).
function CorrelationChainModal({ correlationId, onClose }) {
  const { data: chain = [], isLoading } = useQuery({
    queryKey: ['telemetry-correlation-chain', correlationId],
    queryFn: () => telemetry.correlationChain(correlationId),
  })

  return (
    <Modal title="Correlation Chain" onClose={onClose}>
      <p className="text-xs font-mono text-gray-400 mb-4 break-all">{correlationId}</p>
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && chain.length === 0 && <p className="text-sm text-gray-400">No other events found under this correlation ID.</p>}
      {!isLoading && chain.length > 0 && (
        <div className="overflow-x-auto">
          <div className="space-y-2 min-w-[420px]">
            {chain.map((m, i) => (
              <div key={i} className="flex items-start gap-3 text-xs border-l-2 border-indigo-200 pl-3 py-1">
                <span className="text-gray-400 whitespace-nowrap">{new Date(m.time).toLocaleTimeString()}</span>
                <div className="min-w-0">
                  <div>
                    <span className="font-medium text-gray-800">{m.service_name}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    <span className="font-mono text-indigo-700">{m.metric_name}</span>
                    <span className="text-gray-400 mx-1">=</span>
                    <span className="font-semibold">{m.value}</span>
                  </div>
                  {m.labels_json && Object.keys(m.labels_json).length > 0 && (
                    <p className="text-gray-400 font-mono break-all mt-0.5">{JSON.stringify(m.labels_json)}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  )
}

// EP-102-S9 — cost/token-usage trend charts. Fetched as three separate
// per-metric queries (telemetry-service's GET /metrics only filters on one
// metric_name at a time) and concatenated, so the existing MetricsChart
// component — which already groups by metric_name into one card per metric,
// one line per service — renders all three with no new charting code.
const USAGE_METRICS = ['input_tokens', 'output_tokens', 'estimated_cost_usd']

export function Telemetry() {
  const [tab, setTab] = useState('summary')
  const [filters, setFilters] = useState({ service_name: '', metric_name: '', limit: '200' })
  const [applied, setApplied] = useState(filters)
  const [drilldownId, setDrilldownId] = useState(null)
  const set = k => e => setFilters(f => ({ ...f, [k]: e.target.value }))

  const activeFilters = Object.fromEntries(Object.entries(applied).filter(([, v]) => v))

  const { data: summary = [] } = useQuery({
    queryKey: ['telemetry-summary'],
    queryFn: () => telemetry.summary(),
    enabled: tab === 'summary',
    refetchInterval: 30_000,
  })

  const { data: metrics = [], isLoading } = useQuery({
    queryKey: ['telemetry-metrics', applied],
    queryFn: () => telemetry.query(activeFilters),
    enabled: tab === 'chart' || tab === 'raw',
    refetchInterval: tab === 'chart' ? 15_000 : false,
  })

  const { data: usage = [], isLoading: usageLoading } = useQuery({
    queryKey: ['telemetry-usage'],
    queryFn: async () => {
      const results = await Promise.all(USAGE_METRICS.map(metric_name => telemetry.query({ metric_name, limit: '500' })))
      return results.flat()
    },
    enabled: tab === 'usage',
    refetchInterval: 30_000,
  })

  // EP-311-E1-S1.5 — active budgets, overlaid on the cost chart below.
  const { data: activeBudgets = [] } = useQuery({
    queryKey: ['budgets'],
    queryFn: () => budgetsApi.list(),
    enabled: tab === 'usage',
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Telemetry</h1>
        <p className="text-sm text-gray-500 mt-1">Service metrics and observability</p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {['summary','chart','usage','raw'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm capitalize transition-colors ${tab === t ? 'border-b-2 border-indigo-600 text-indigo-700 font-medium' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'usage' ? 'AI cost & tokens' : t}
          </button>
        ))}
      </div>

      {(tab === 'chart' || tab === 'raw') && (
        <Card>
          <CardHeader>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
              <div><Label>Service</Label><Input value={filters.service_name} onChange={set('service_name')} placeholder="e.g. governance-service" /></div>
              <div><Label>Metric</Label><Input value={filters.metric_name} onChange={set('metric_name')} placeholder="e.g. request_count" /></div>
              <div><Label>Limit</Label>
                <Select value={filters.limit} onChange={set('limit')}>
                  {['100','200','500','1000'].map(v => <option key={v}>{v}</option>)}
                </Select>
              </div>
            </div>
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={() => setApplied(filters)}>Apply</Button>
            </div>
          </CardHeader>
        </Card>
      )}

      {tab === 'summary' && <SummaryCards data={summary} />}

      {tab === 'chart' && <MetricsChart data={metrics} />}

      {tab === 'usage' && (
        usageLoading ? <p className="text-sm text-gray-400">Loading…</p> : <MetricsChart data={usage} budgets={activeBudgets} />
      )}

      {tab === 'raw' && (
        <Card>
          <Table>
            <thead><tr><Th>Time</Th><Th>Service</Th><Th>Metric</Th><Th>Value</Th><Th>Correlation</Th><Th>Labels</Th></tr></thead>
            <tbody>
              {isLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}
              {metrics.map((m, i) => (
                <Tr key={i}>
                  <Td className="text-xs text-gray-500">{new Date(m.time).toLocaleString()}</Td>
                  <Td>{m.service_name}</Td>
                  <Td className="font-mono text-xs">{m.metric_name}</Td>
                  <Td className="font-semibold">{m.value}</Td>
                  <Td>
                    {/* EP-102-S8 — drill into the full chain sharing this correlation_id */}
                    {m.correlation_id
                      ? <button type="button" className="font-mono text-xs text-indigo-600 hover:underline"
                          onClick={() => setDrilldownId(m.correlation_id)}>
                          {m.correlation_id.slice(0, 8)}…
                        </button>
                      : <span className="text-xs text-gray-300">—</span>}
                  </Td>
                  <Td className="font-mono text-xs text-gray-400">{JSON.stringify(m.labels_json)}</Td>
                </Tr>
              ))}
              {!isLoading && metrics.length === 0 && <tr><Td colSpan={6} className="text-center text-gray-400">No data</Td></tr>}
            </tbody>
          </Table>
        </Card>
      )}

      {drilldownId && <CorrelationChainModal correlationId={drilldownId} onClose={() => setDrilldownId(null)} />}
    </div>
  )
}
