import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FlaskConical, CheckCircle, XCircle, SkipForward, AlertCircle, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { controlTests } from '../../lib/api'

const RESULT_ICON = {
  pass:    <CheckCircle size={14} className="text-green-500" />,
  fail:    <XCircle    size={14} className="text-red-500"   />,
  skipped: <SkipForward size={14} className="text-yellow-500" />,
  error:   <AlertCircle size={14} className="text-orange-500" />,
}

const RESULT_VARIANT = {
  pass:    'success',
  fail:    'danger',
  skipped: 'warning',
  error:   'warning',
}

const TYPE_VARIANT = {
  auth:          'danger',
  telemetry:     'info',
  availability:  'purple',
  configuration: 'default',
}

function passRate(test) {
  const total = test.total_runs ?? 0
  if (total === 0) return null
  return Math.round(((test.pass_count ?? 0) / total) * 100)
}

function PassRateBar({ rate }) {
  if (rate === null) return <span className="text-xs text-gray-400">no runs yet</span>
  const color = rate >= 90 ? 'bg-green-500' : rate >= 70 ? 'bg-yellow-400' : 'bg-red-500'
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="text-xs text-gray-500 w-8 text-right">{rate}%</span>
    </div>
  )
}

function RunHistoryRow({ testId }) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['control-test-runs', testId],
    queryFn:  () => controlTests.listRuns(testId),
  })

  if (isLoading) return <p className="text-xs text-gray-400 py-2">Loading…</p>
  if (runs.length === 0) return <p className="text-xs text-gray-400 py-2">No runs recorded yet.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-gray-500 border-b border-gray-100">
            <th className="pb-1 pr-4 font-medium">Result</th>
            <th className="pb-1 pr-4 font-medium">Duration</th>
            <th className="pb-1 pr-4 font-medium">Ran at</th>
            <th className="pb-1 font-medium">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className="border-b border-gray-50 last:border-0">
              <td className="py-1.5 pr-4">
                <div className="flex items-center gap-1">
                  {RESULT_ICON[r.result]}
                  <Badge variant={RESULT_VARIANT[r.result] ?? 'default'}>{r.result}</Badge>
                </div>
              </td>
              <td className="py-1.5 pr-4 text-gray-500">{r.duration_ms != null ? `${r.duration_ms}ms` : '—'}</td>
              <td className="py-1.5 pr-4 text-gray-500">{new Date(r.ran_at).toLocaleString()}</td>
              <td className="py-1.5 text-gray-400 font-mono max-w-xs truncate">
                {r.evidence ? JSON.stringify(r.evidence) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TestRow({ test }) {
  const [expanded, setExpanded] = useState(false)
  const rate = passRate(test)

  return (
    <>
      <tr
        className="border-b border-gray-100 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="px-4 py-3 w-6">
          {expanded
            ? <ChevronDown size={13} className="text-gray-400" />
            : <ChevronRight size={13} className="text-gray-400" />}
        </td>
        <td className="px-4 py-3">
          <div className="text-sm font-medium text-gray-800">{test.name.replace(/_/g, ' ')}</div>
          <div className="text-xs text-gray-400 mt-0.5">{test.description}</div>
        </td>
        <td className="px-4 py-3">
          <Badge variant={TYPE_VARIANT[test.test_type] ?? 'default'}>{test.test_type}</Badge>
        </td>
        <td className="px-4 py-3">
          {test.last_result ? (
            <div className="flex items-center gap-1.5">
              {RESULT_ICON[test.last_result]}
              <Badge variant={RESULT_VARIANT[test.last_result] ?? 'default'}>{test.last_result}</Badge>
            </div>
          ) : (
            <span className="text-xs text-gray-400">never run</span>
          )}
        </td>
        <td className="px-4 py-3 w-48">
          <PassRateBar rate={rate} />
        </td>
        <td className="px-4 py-3 text-xs text-gray-400">
          {test.last_run_at ? new Date(test.last_run_at).toLocaleString() : '—'}
        </td>
        <td className="px-4 py-3 text-xs text-gray-400">
          every {test.schedule_minutes} min
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50 border-b border-gray-100">
          <td colSpan={7} className="px-8 py-3">
            <RunHistoryRow testId={test.id} />
          </td>
        </tr>
      )}
    </>
  )
}

export function ControlTests() {
  const qc = useQueryClient()
  const { data: tests = [], isLoading } = useQuery({
    queryKey:      ['control-tests'],
    queryFn:       () => controlTests.list(),
    refetchInterval: 60_000,
  })

  const passing  = tests.filter(t => t.last_result === 'pass').length
  const failing  = tests.filter(t => t.last_result === 'fail').length
  const pending  = tests.filter(t => !t.last_result).length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FlaskConical size={22} className="text-indigo-500" />
            Control Testing
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Scheduled tests that verify controls actively work — not just that they're configured.
            Failed tests create CRITICAL violations and escalation incidents.
          </p>
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['control-tests'] })}
          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors mt-1"
          title="Refresh"
        >
          <RefreshCw size={15} />
        </button>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-green-600">{passing}</div>
            <div className="text-xs text-gray-500 mt-0.5">Passing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-red-500">{failing}</div>
            <div className="text-xs text-gray-500 mt-0.5">Failing</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-3 text-center">
            <div className="text-2xl font-bold text-gray-400">{pending}</div>
            <div className="text-xs text-gray-500 mt-0.5">Pending first run</div>
          </CardContent>
        </Card>
      </div>

      {/* Test grid */}
      <Card>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="px-4 py-3 w-6" />
                <th className="px-4 py-3 font-medium">Test</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Last Result</th>
                <th className="px-4 py-3 font-medium w-48">Pass Rate</th>
                <th className="px-4 py-3 font-medium">Last Run</th>
                <th className="px-4 py-3 font-medium">Schedule</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && tests.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-gray-400">
                  No control tests found. Run <code>npm run migrate</code> to seed the built-in tests.
                </td></tr>
              )}
              {tests.map(t => <TestRow key={t.id} test={t} />)}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
