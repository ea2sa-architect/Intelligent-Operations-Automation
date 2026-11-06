import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Shield, Brain, AlertTriangle, Plug, CheckCircle2, XCircle, AlertCircle, ShieldCheck, Gauge } from 'lucide-react'
import { Card, CardContent } from '../components/ui/Card'
import { governance, escalation, inference, platforms as platformsApi, trust } from '../lib/api'

const ATI_LEVEL_STYLE = {
  LOW:      { text: 'text-red-700',    bg: 'bg-red-50',    ring: 'ring-red-200' },
  MODERATE: { text: 'text-yellow-700', bg: 'bg-yellow-50', ring: 'ring-yellow-200' },
  HIGH:     { text: 'text-green-700',  bg: 'bg-green-50',  ring: 'ring-green-200' },
  VERIFIED: { text: 'text-indigo-700', bg: 'bg-indigo-50', ring: 'ring-indigo-200' },
}

function atiLevelFor(score) {
  if (score == null)  return 'MODERATE'
  if (score < 40)      return 'LOW'
  if (score < 65)      return 'MODERATE'
  if (score < 85)      return 'HIGH'
  return 'VERIFIED'
}

function AtiCard({ data, isLoading }) {
  const navigate = useNavigate()
  const style = ATI_LEVEL_STYLE[atiLevelFor(data?.avg_ati_score)]

  return (
    <Card className="ring-1 ring-inset ring-gray-100">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-4">
          <div className={`p-4 rounded-xl ${style.bg}`}>
            <ShieldCheck size={28} className={style.text} />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Automation Trust Index</p>
            <p className="text-3xl font-bold text-gray-900">
              {isLoading ? '—' : (data?.avg_ati_score ?? '—')}
              <span className="text-base font-normal text-gray-400"> / 100</span>
            </p>
            {!isLoading && data?.provisional_workflows > 0 && (
              <p className="text-xs text-amber-600 mt-1">
                {data.provisional_workflows} of {data.total_workflows} workflow(s) are provisional —
                governance, assurance, or operational signals not yet wired for them.
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate('/workflows')}
          className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors shrink-0"
        >
          View by workflow →
        </button>
      </CardContent>
    </Card>
  )
}

const PLATFORM_LABEL = {
  n8n:            'n8n',
  make:           'Make.com',
  zapier:         'Zapier',
  power_automate: 'Power Automate',
}

function StatCard({ icon: Icon, label, value, color, onClick }) {
  const content = (
    <CardContent className="flex items-center gap-4 py-5">
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon size={20} className="text-white" />
      </div>
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold text-gray-900">{value ?? '—'}</p>
      </div>
    </CardContent>
  )
  return onClick
    ? <button onClick={onClick} className="text-left w-full block rounded-xl ring-1 ring-gray-200 hover:ring-indigo-400 hover:shadow-sm transition-all">{content}</button>
    : <Card>{content}</Card>
}

// EP-201-S11 — "enforcement activity count + block/warn ratio card". Sits
// alongside the ATI card as the other headline number: ATI says how
// trustworthy things look, this says how much the platform actually DID
// about it — allow/warn/block counts, and how much of that was in the last
// 24h, so "is enforcement live or just observing" is answerable at a glance.
function EnforcementActivityCard({ data, isLoading }) {
  const navigate = useNavigate()
  const total  = Number(data?.total ?? 0)
  const warn   = Number(data?.warn ?? 0)
  const block  = Number(data?.block ?? 0)
  const allow  = Number(data?.allow ?? 0)
  const last24h = Number(data?.last_24h ?? 0)
  const ratioDenominator = warn + block
  const blockRatio = ratioDenominator > 0 ? Math.round((block / ratioDenominator) * 100) : null

  return (
    <Card className="ring-1 ring-inset ring-gray-100">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 py-6">
        <div className="flex items-center gap-4">
          <div className="p-4 rounded-xl bg-indigo-50">
            <Gauge size={28} className="text-indigo-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wide">Enforcement Activity</p>
            <p className="text-3xl font-bold text-gray-900">
              {isLoading ? '—' : total}
              <span className="text-base font-normal text-gray-400"> decisions</span>
            </p>
            {!isLoading && (
              <p className="text-xs text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
                <span className="text-gray-600">{allow} allowed</span>
                <span className="text-yellow-600">{warn} warned</span>
                <span className="text-red-600">{block} blocked</span>
                {blockRatio != null && <span className="text-gray-400">· {blockRatio}% of flagged were blocked</span>}
                {last24h > 0 && <span className="text-gray-400">· {last24h} in last 24h</span>}
              </p>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate('/enforcement')}
          className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors shrink-0"
        >
          View event history →
        </button>
      </CardContent>
    </Card>
  )
}

function PlatformStatusBar({ connections }) {
  const navigate = useNavigate()

  if (!connections || connections.length === 0) {
    return (
      <button
        onClick={() => navigate('/admin/integrations')}
        className="flex items-center gap-2 text-xs text-gray-400 hover:text-indigo-600 transition-colors"
      >
        <Plug size={13} />
        No platforms connected — configure integrations
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-400 font-medium uppercase tracking-wide">Platforms</span>
      {connections.map(conn => {
        const isOk  = conn.status === 'connected'
        const isErr = conn.status === 'error'
        const Icon  = isOk ? CheckCircle2 : isErr ? XCircle : AlertCircle
        return (
          <button
            key={conn.id}
            onClick={() => navigate('/admin/integrations')}
            title={conn.error_message ?? conn.name}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors hover:opacity-80 ${
              isOk  ? 'bg-green-50 border-green-200 text-green-700' :
              isErr ? 'bg-red-50   border-red-200   text-red-700'   :
                      'bg-gray-50  border-gray-200  text-gray-500'
            }`}
          >
            <Icon size={11} />
            {PLATFORM_LABEL[conn.platform] ?? conn.platform}
            {conn.workflow_count > 0 && (
              <span className="opacity-60">· {conn.workflow_count}</span>
            )}
          </button>
        )
      })}
      <button
        onClick={() => navigate('/admin/integrations')}
        className="text-xs text-indigo-500 hover:text-indigo-700 transition-colors"
      >
        Manage
      </button>
    </div>
  )
}

export function Dashboard() {
  const navigate    = useNavigate()
  const policies    = useQuery({ queryKey: ['policies'],          queryFn: () => governance.listPolicies() })
  const active      = useQuery({ queryKey: ['policies','active'], queryFn: () => governance.listPolicies('active') })
  const incidents   = useQuery({ queryKey: ['incidents','open'],  queryFn: () => escalation.listIncidents({ status: 'open' }) })
  const models      = useQuery({ queryKey: ['models','active'],   queryFn: () => inference.listModels('active') })
  const connections = useQuery({ queryKey: ['platforms'],         queryFn: platformsApi.list, staleTime: 60_000 })
  const atiSummary  = useQuery({ queryKey: ['trust','summary'],   queryFn: trust.summary })
  const enforcement = useQuery({ queryKey: ['enforcement','summary'], queryFn: governance.enforcementSummary })

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">IOA Governance Platform overview</p>
        </div>
        <PlatformStatusBar connections={connections.data} />
      </div>

      <AtiCard data={atiSummary.data} isLoading={atiSummary.isLoading} />
      <EnforcementActivityCard data={enforcement.data} isLoading={enforcement.isLoading} />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Shield}        label="Total Policies"   value={policies.data?.length}  color="bg-indigo-500" onClick={() => navigate('/governance')} />
        <StatCard icon={Shield}        label="Active Policies"  value={active.data?.length}    color="bg-green-500"  onClick={() => navigate('/governance?status=active')} />
        <StatCard icon={AlertTriangle} label="Open Incidents"   value={incidents.data?.length} color="bg-red-500" />
        <StatCard icon={Brain}         label="Active Models"    value={models.data?.length}    color="bg-purple-500" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-500" />
            <h2 className="text-sm font-semibold text-gray-900">Open Incidents</h2>
          </div>
          <CardContent className="p-0">
            {incidents.data?.length === 0 && (
              <p className="px-6 py-4 text-sm text-gray-400">No open incidents</p>
            )}
            {incidents.data?.map(inc => (
              <div key={inc.id} className="px-6 py-3 border-b border-gray-100 last:border-0">
                <p className="text-sm font-medium text-gray-800">{inc.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">{inc.severity} · {new Date(inc.triggered_at).toLocaleString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <div className="px-6 py-4 border-b border-gray-200 flex items-center gap-2">
            <Shield size={16} className="text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-900">Recent Policies</h2>
          </div>
          <CardContent className="p-0">
            {policies.data?.slice(0, 5).map(p => (
              <div key={p.id} className="px-6 py-3 border-b border-gray-100 last:border-0">
                <p className="text-sm font-medium text-gray-800">{p.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{p.status} · v{p.version}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
