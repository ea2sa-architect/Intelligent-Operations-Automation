import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { anomaly, attackPaths } from '../lib/api'
import {
  AlertTriangle, ChevronDown, ChevronRight, RefreshCw,
  ShieldAlert, Zap, Activity, Target, GitBranch,
} from 'lucide-react'

// ── Helpers ────────────────────────────────────────────────────────────────

const SEVERITY_COLORS = {
  critical: 'bg-red-100 text-red-800',
  high:     'bg-orange-100 text-orange-800',
  medium:   'bg-yellow-100 text-yellow-800',
  low:      'bg-blue-100 text-blue-800',
}

const ALERT_TYPE_LABELS = {
  unexpected_tool: 'Unexpected Tool',
  excessive_loop:  'Excessive Loop',
  new_destination: 'New Destination',
  latency_spike:   'Latency Spike',
  unusual_volume:  'Unusual Volume',
}

const ALERT_TYPE_ICONS = {
  unexpected_tool: <Target size={14} />,
  excessive_loop:  <RefreshCw size={14} />,
  new_destination: <GitBranch size={14} />,
  latency_spike:   <Zap size={14} />,
  unusual_volume:  <Activity size={14} />,
}

function Badge({ label, colorClass }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {label}
    </span>
  )
}

// ── Attack-path risk bar ───────────────────────────────────────────────────

function RiskBar({ score }) {
  const color = score >= 75 ? 'bg-red-500' : score >= 50 ? 'bg-orange-500' : score >= 25 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{score}</span>
    </div>
  )
}

// ── Attack-path expandable row ─────────────────────────────────────────────

function AttackPathRow({ path }) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()
  const rebuild = useMutation({
    mutationFn: () => attackPaths.rebuildOne(path.mcp_server_id),
    onSuccess:  () => qc.invalidateQueries(['attack-paths']),
  })

  const tools  = path.reachable_tools        ?? []
  const dests  = path.external_destinations  ?? []
  const peers  = path.cross_server_paths     ?? []
  const factors = path.risk_factors          ?? []

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="flex-1 font-medium text-sm">{path.server_name}</span>
        <span className="text-xs text-gray-500 mr-4">{tools.length} tools · {dests.length} ext destinations</span>
        <div className="w-32"><RiskBar score={path.risk_score} /></div>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50/50 space-y-4">

          {/* Risk factors */}
          {factors.length > 0 && (
            <div className="pt-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Risk Factors</p>
              <div className="space-y-1">
                {factors.map((f, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <Badge label={f.severity} colorClass={SEVERITY_COLORS[f.severity] ?? ''} />
                    <span className="text-sm text-gray-700">{f.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Reachable tools */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Reachable Tools ({tools.length})</p>
              <div className="space-y-1">
                {tools.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-sm text-gray-700">{t.name}</span>
                    {t.risk_level && (
                      <Badge label={t.risk_level} colorClass={SEVERITY_COLORS[t.risk_level] ?? 'bg-gray-100 text-gray-700'} />
                    )}
                  </div>
                ))}
                {!tools.length && <p className="text-xs text-gray-400">None registered</p>}
              </div>
            </div>

            {/* External destinations */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">External Destinations ({dests.length})</p>
              <div className="space-y-1">
                {dests.map((d, i) => (
                  <div key={i} className="text-sm text-gray-700">
                    {d.service_name}
                    {d.data_classification && (
                      <span className="ml-2 text-xs text-gray-400">({d.data_classification})</span>
                    )}
                  </div>
                ))}
                {!dests.length && <p className="text-xs text-gray-400">None observed</p>}
              </div>
            </div>

            {/* Cross-server trust paths */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Shared Chains ({peers.length})</p>
              <div className="space-y-1">
                {peers.map((p, i) => (
                  <div key={i} className="text-sm text-gray-700">{p.peer_server_name ?? p.peer_server_id}</div>
                ))}
                {!peers.length && <p className="text-xs text-gray-400">No shared chains</p>}
              </div>
            </div>
          </div>

          <button
            onClick={() => rebuild.mutate()}
            disabled={rebuild.isPending}
            className="text-xs text-indigo-600 hover:underline disabled:opacity-50"
          >
            {rebuild.isPending ? 'Rebuilding…' : 'Rebuild attack path'}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Alert row ──────────────────────────────────────────────────────────────

function AlertRow({ alert }) {
  const [open, setOpen]  = useState(false)
  const qc               = useQueryClient()
  const patch            = useMutation({
    mutationFn: (status) => anomaly.patchAlert(alert.id, { status }),
    onSuccess:  () => qc.invalidateQueries(['anomaly-alerts']),
  })

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="flex items-center gap-1.5 text-gray-500">
          {ALERT_TYPE_ICONS[alert.alert_type]}
        </span>
        <span className="flex-1 text-sm font-medium">
          {ALERT_TYPE_LABELS[alert.alert_type] ?? alert.alert_type}
          {alert.workflow_name && <span className="text-gray-400 font-normal"> — {alert.workflow_name}</span>}
        </span>
        <Badge label={alert.severity} colorClass={SEVERITY_COLORS[alert.severity] ?? ''} />
        <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
          alert.status === 'open' ? 'bg-red-50 text-red-700'
          : alert.status === 'acknowledged' ? 'bg-yellow-50 text-yellow-700'
          : 'bg-green-50 text-green-700'
        }`}>{alert.status}</span>
        <span className="text-xs text-gray-400 ml-3">{new Date(alert.created_at).toLocaleString()}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50/50">
          <div className="pt-3 space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-gray-500">Correlation ID</span>
                <p className="font-mono text-xs mt-0.5 break-all">{alert.correlation_id}</p>
              </div>
              {alert.deviation_score != null && (
                <div>
                  <span className="text-gray-500">Deviation Score</span>
                  <p className="font-semibold mt-0.5">{Number(alert.deviation_score).toFixed(2)}σ</p>
                </div>
              )}
            </div>

            {alert.details_json && Object.keys(alert.details_json).length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Details</p>
                <pre className="text-xs bg-gray-100 rounded p-2 overflow-x-auto">
                  {JSON.stringify(alert.details_json, null, 2)}
                </pre>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              {alert.status === 'open' && (
                <button
                  onClick={() => patch.mutate('acknowledged')}
                  disabled={patch.isPending}
                  className="text-xs px-3 py-1.5 rounded bg-yellow-100 text-yellow-800 hover:bg-yellow-200 disabled:opacity-50"
                >
                  Acknowledge
                </button>
              )}
              {alert.status !== 'resolved' && (
                <button
                  onClick={() => patch.mutate('resolved')}
                  disabled={patch.isPending}
                  className="text-xs px-3 py-1.5 rounded bg-green-100 text-green-800 hover:bg-green-200 disabled:opacity-50"
                >
                  Resolve
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Baselines table ────────────────────────────────────────────────────────

function BaselinesPanel() {
  const qc       = useQueryClient()
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['baselines'],
    queryFn:  anomaly.listBaselines,
  })

  return (
    <div className="space-y-3">
      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}
      {!isLoading && !rows.length && (
        <p className="text-sm text-gray-500">No baselines computed yet. Trigger baseline computation from the workflow detail or use POST /anomaly/baselines/:id/compute.</p>
      )}
      {rows.map(b => (
        <div key={b.id} className="border border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium text-sm">{b.workflow_name ?? b.workflow_id}</span>
            <span className="text-xs text-gray-400">{b.sample_count} samples · computed {new Date(b.computed_at).toLocaleDateString()}</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <p className="text-xs text-gray-500">Avg Latency</p>
              <p className="font-mono">{b.avg_latency_ms ? `${Math.round(b.avg_latency_ms)}ms` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">p95 Latency</p>
              <p className="font-mono">{b.p95_latency_ms ? `${Math.round(b.p95_latency_ms)}ms` : '—'}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Max Loop Depth</p>
              <p className="font-mono">{b.max_loop_depth ?? 0}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Known Tools</p>
              <p className="font-mono">{(b.known_tools ?? []).length}</p>
            </div>
          </div>
          {(b.typical_tool_sequence ?? []).length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-gray-500 mb-1">Typical Tool Sequence</p>
              <div className="flex flex-wrap gap-1">
                {b.typical_tool_sequence.map((t, i) => (
                  <span key={i} className="text-xs bg-indigo-50 text-indigo-700 rounded px-2 py-0.5">
                    {i + 1}. {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

const TABS = ['Alerts', 'Baselines', 'Attack Paths']

export function AnomalyDetection() {
  const [tab,       setTab]       = useState('Alerts')
  const [alertFilter, setAlertFilter] = useState('open')
  const qc = useQueryClient()

  const { data: summary } = useQuery({ queryKey: ['anomaly-summary'], queryFn: anomaly.summary })
  const { data: apSummary } = useQuery({ queryKey: ['ap-summary'], queryFn: attackPaths.summary })

  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['anomaly-alerts', alertFilter],
    queryFn:  () => anomaly.listAlerts(alertFilter ? { status: alertFilter } : {}),
    enabled:  tab === 'Alerts',
  })

  const { data: paths = [], isLoading: pathsLoading } = useQuery({
    queryKey: ['attack-paths'],
    queryFn:  attackPaths.list,
    enabled:  tab === 'Attack Paths',
  })

  const rebuildAll = useMutation({
    mutationFn: attackPaths.rebuild,
    onSuccess:  () => qc.invalidateQueries(['attack-paths']),
  })

  const s = summary?.alerts ?? {}

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <ShieldAlert size={22} className="text-orange-500" />
        <h1 className="text-xl font-bold">Anomaly Detection</h1>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Open Alerts',      value: s.open,             color: 'text-red-600' },
          { label: 'Critical',         value: s.critical,         color: 'text-red-700' },
          { label: 'High',             value: s.high,             color: 'text-orange-600' },
          { label: 'Baselines',        value: summary?.baselines, color: 'text-indigo-600' },
          { label: 'Attack Paths',     value: apSummary?.total,   color: 'text-purple-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
            <p className="text-xs text-gray-500 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Alert type breakdown */}
      {tab === 'Alerts' && s.total > 0 && (
        <div className="flex flex-wrap gap-2">
          {[
            ['unexpected_tool', s.unexpected_tool],
            ['new_destination', s.new_destination],
            ['latency_spike',   s.latency_spike],
            ['excessive_loop',  s.excessive_loop],
          ].filter(([, n]) => n > 0).map(([type, n]) => (
            <button
              key={type}
              onClick={() => setAlertFilter(prev => prev === type ? '' : type)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                alertFilter === type
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white border-gray-200 hover:border-indigo-400'
              }`}
            >
              {ALERT_TYPE_ICONS[type]}
              {ALERT_TYPE_LABELS[type]} ({n})
            </button>
          ))}
          {alertFilter && (
            <button onClick={() => setAlertFilter('')} className="text-xs text-gray-500 hover:text-gray-700 px-2">
              Clear filter
            </button>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-indigo-600 text-indigo-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >{t}</button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {tab === 'Alerts' && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <select
              value={alertFilter}
              onChange={e => setAlertFilter(e.target.value)}
              className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
            <span className="text-sm text-gray-400">{alerts.length} alert{alerts.length !== 1 ? 's' : ''}</span>
          </div>
          {alertsLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {!alertsLoading && !alerts.length && (
            <p className="text-sm text-gray-500 py-4 text-center">No alerts match the current filter.</p>
          )}
          {alerts.map(a => <AlertRow key={a.id} alert={a} />)}
        </div>
      )}

      {tab === 'Baselines' && <BaselinesPanel />}

      {tab === 'Attack Paths' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500">
              {apSummary && `Avg risk: ${apSummary.avg_risk_score ?? '—'} · Max: ${apSummary.max_risk_score ?? '—'} · Critical risk servers: ${apSummary.critical_risk ?? 0}`}
            </div>
            <button
              onClick={() => rebuildAll.mutate()}
              disabled={rebuildAll.isPending}
              className="flex items-center gap-2 text-sm px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              <RefreshCw size={14} className={rebuildAll.isPending ? 'animate-spin' : ''} />
              {rebuildAll.isPending ? 'Rebuilding…' : 'Rebuild All'}
            </button>
          </div>
          {pathsLoading && <p className="text-sm text-gray-400">Loading…</p>}
          {!pathsLoading && !paths.length && (
            <p className="text-sm text-gray-500 py-4 text-center">No attack paths computed yet — click Rebuild All to scan approved MCP servers.</p>
          )}
          {paths.map(p => <AttackPathRow key={p.id} path={p} />)}
        </div>
      )}
    </div>
  )
}
