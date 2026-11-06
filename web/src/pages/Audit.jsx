import { useState, useMemo } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { ChevronUp, ChevronDown, Download } from 'lucide-react'
import { audit, downloadJson } from '../lib/api'
import { useAuth } from '../components/AuthGuard'
import { Card, CardHeader } from '../components/ui/Card'
import { Table, Th, Td, Tr } from '../components/ui/Table'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Label, Select } from '../components/ui/Input'
import { Modal } from '../components/ui/Modal'

const outcomeVariant = { success: 'success', failure: 'danger', partial: 'warning' }

export function Audit() {
  const { hasPermission } = useAuth()
  const [actorFilter,    setActorFilter]    = useState('')
  const [resourceFilter, setResourceFilter] = useState('')
  const [eventFilter,    setEventFilter]    = useState('')
  const [outcomeFilter,  setOutcomeFilter]  = useState('')
  const [selected,       setSelected]       = useState(null)
  const [sortCol,        setSortCol]        = useState('created_at')
  const [sortDir,        setSortDir]        = useState('desc')

  const { data: allEvents = [], isLoading } = useQuery({
    queryKey: ['audit-events-all'],
    queryFn:  () => audit.listEvents({ limit: 500 }),
    staleTime: 30_000,
  })

  // Derive dropdown options from the full dataset
  const actorOptions    = useMemo(() => [...new Set(allEvents.map(e => e.actor_id).filter(Boolean))].sort(),      [allEvents])
  const resourceOptions = useMemo(() => [...new Set(allEvents.map(e => e.resource_type).filter(Boolean))].sort(), [allEvents])
  const eventOptions    = useMemo(() => [...new Set(allEvents.map(e => e.event_type).filter(Boolean))].sort(),    [allEvents])

  const filtered = useMemo(() => allEvents.filter(e => {
    if (actorFilter    && e.actor_id      !== actorFilter)    return false
    if (resourceFilter && e.resource_type !== resourceFilter) return false
    if (eventFilter    && e.event_type    !== eventFilter)    return false
    if (outcomeFilter  && e.outcome       !== outcomeFilter)  return false
    return true
  }), [allEvents, actorFilter, resourceFilter, eventFilter, outcomeFilter])

  const sorted = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortCol) {
        case 'event_type': return dir * (a.event_type ?? '').localeCompare(b.event_type ?? '')
        case 'actor':      return dir * `${a.actor_type}/${a.actor_id}`.localeCompare(`${b.actor_type}/${b.actor_id}`)
        case 'resource':   return dir * `${a.resource_type}/${a.resource_id}`.localeCompare(`${b.resource_type}/${b.resource_id}`)
        case 'action':     return dir * (a.action ?? '').localeCompare(b.action ?? '')
        case 'outcome':    return dir * (a.outcome ?? '').localeCompare(b.outcome ?? '')
        case 'created_at': return dir * (new Date(a.created_at) - new Date(b.created_at))
        default: return 0
      }
    })
  }, [filtered, sortCol, sortDir])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'created_at' ? 'desc' : 'asc') }
  }

  function SortTh({ col, children }) {
    const active = sortCol === col
    return (
      <Th>
        <button onClick={() => toggleSort(col)}
          className="flex items-center gap-1 hover:text-gray-900 transition-colors select-none whitespace-nowrap">
          {children}
          <span className="flex flex-col -space-y-1">
            <ChevronUp   size={10} className={active && sortDir === 'asc'  ? 'text-indigo-600' : 'text-gray-300'} />
            <ChevronDown size={10} className={active && sortDir === 'desc' ? 'text-indigo-600' : 'text-gray-300'} />
          </span>
        </button>
      </Th>
    )
  }

  const hasFilter = actorFilter || resourceFilter || eventFilter || outcomeFilter

  // On-demand backup, independent of Clear All (workflow-governance-service)
  // — nothing in this platform deletes audit events today, so this exists
  // purely so an admin can archive the log, not as a pre-delete safety net.
  const backup = useMutation({
    mutationFn: () => audit.exportBackup(),
    onSuccess: data => downloadJson(data, `ioa-audit-backup-${data.exported_at.slice(0, 10)}.json`),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-1">Compliance event history</p>
        </div>
        {hasPermission('audit:read') && (
          <Button variant="secondary" onClick={() => backup.mutate()} disabled={backup.isPending}>
            <Download size={15} />
            {backup.isPending ? 'Backing up…' : 'Backup Audit Log'}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <Label>Actor ID</Label>
              <Select value={actorFilter} onChange={e => setActorFilter(e.target.value)}>
                <option value="">All actors</option>
                {actorOptions.map(a => <option key={a} value={a}>{a}</option>)}
              </Select>
            </div>
            <div>
              <Label>Resource Type</Label>
              <Select value={resourceFilter} onChange={e => setResourceFilter(e.target.value)}>
                <option value="">All resources</option>
                {resourceOptions.map(r => <option key={r} value={r}>{r}</option>)}
              </Select>
            </div>
            <div>
              <Label>Event Type</Label>
              <Select value={eventFilter} onChange={e => setEventFilter(e.target.value)}>
                <option value="">All event types</option>
                {eventOptions.map(t => <option key={t} value={t}>{t}</option>)}
              </Select>
            </div>
            <div>
              <Label>Outcome</Label>
              <Select value={outcomeFilter} onChange={e => setOutcomeFilter(e.target.value)}>
                <option value="">All outcomes</option>
                <option>success</option><option>failure</option><option>partial</option>
              </Select>
            </div>
          </div>
          {hasFilter && (
            <div className="mt-2 flex items-center gap-3">
              <span className="text-xs text-gray-500">{sorted.length} of {allEvents.length} events</span>
              <button
                onClick={() => { setActorFilter(''); setResourceFilter(''); setEventFilter(''); setOutcomeFilter('') }}
                className="text-xs text-indigo-600 hover:underline"
              >
                Clear filters
              </button>
            </div>
          )}
        </CardHeader>

        <Table>
          <thead><tr>
            <SortTh col="event_type">Event Type</SortTh>
            <SortTh col="actor">Actor</SortTh>
            <SortTh col="resource">Resource</SortTh>
            <SortTh col="action">Action</SortTh>
            <SortTh col="outcome">Outcome</SortTh>
            <SortTh col="created_at">Time</SortTh>
          </tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}
            {sorted.map(e => (
              <Tr key={`${e.id}-${e.created_at}`} onClick={() => setSelected(e)}>
                <Td className="font-mono text-xs">{e.event_type}</Td>
                <Td className="text-xs">{e.actor_type}/{e.actor_id}</Td>
                <Td className="text-xs">{e.resource_type}/{e.resource_id}</Td>
                <Td className="text-xs">{e.action}</Td>
                <Td><Badge variant={outcomeVariant[e.outcome]}>{e.outcome}</Badge></Td>
                <Td className="text-xs text-gray-400">{new Date(e.created_at).toLocaleString()}</Td>
              </Tr>
            ))}
            {!isLoading && sorted.length === 0 && (
              <tr><Td colSpan={6} className="text-center text-gray-400">No events</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>

      {selected && (
        <Modal title="Audit Event" onClose={() => setSelected(null)}>
          <dl className="space-y-3 text-sm">
            {Object.entries(selected).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs font-medium text-gray-500 uppercase">{k}</dt>
                <dd className="mt-0.5 text-gray-800 font-mono text-xs break-all">
                  {typeof v === 'object' ? JSON.stringify(v, null, 2) : String(v)}
                </dd>
              </div>
            ))}
          </dl>
        </Modal>
      )}
    </div>
  )
}
