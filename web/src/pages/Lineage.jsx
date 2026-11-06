import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Share2, RefreshCw, AlertTriangle, ExternalLink, ChevronDown, ChevronRight } from 'lucide-react'
import { Card, CardContent } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { lineage } from '../lib/api'

// ── Classification color scheme (light / dark aware via CSS vars isn't easy
// in SVG; we use explicit light-mode values and rely on the white SVG bg) ──
const CLASS_COLORS = {
  public:       { fill: '#dcfce7', stroke: '#16a34a', text: '#14532d' },
  internal:     { fill: '#dbeafe', stroke: '#2563eb', text: '#1e3a5f' },
  confidential: { fill: '#fef3c7', stroke: '#d97706', text: '#78350f' },
  pii:          { fill: '#fee2e2', stroke: '#dc2626', text: '#7f1d1d' },
  restricted:   { fill: '#fce7f3', stroke: '#9d174d', text: '#831843' },
  unknown:      { fill: '#f3f4f6', stroke: '#9ca3af', text: '#374151' },
}

const TYPE_ICONS = {
  workflow:     '⚙',
  model:        '🧠',
  mcp_server:   '🔌',
  tool:         '🔧',
  external_api: '🌐',
  database:     '🗄',
  webhook:      '📡',
  user:         '👤',
}

const CLASS_VARIANT = {
  public:       'success',
  internal:     'info',
  confidential: 'warning',
  pii:          'danger',
  restricted:   'danger',
  unknown:      'default',
}

// ── SVG DAG renderer ──────────────────────────────────────────────────────────
// Pure React/SVG — no external layout lib. Assigns nodes to layers via BFS
// from roots, then spaces them horizontally left-to-right.

const NODE_W = 160
const NODE_H = 64
const COL_GAP = 60
const ROW_GAP = 20
const PAD = 24

function computeLayout(nodes, edges) {
  if (!nodes.length) return { positions: {}, width: 0, height: 0 }

  const idMap   = Object.fromEntries(nodes.map(n => [n.id, n]))
  const inDeg   = Object.fromEntries(nodes.map(n => [n.id, 0]))
  const outEdges = Object.fromEntries(nodes.map(n => [n.id, []]))

  for (const e of edges) {
    if (inDeg[e.to_node_id] !== undefined) inDeg[e.to_node_id]++
    if (outEdges[e.from_node_id]) outEdges[e.from_node_id].push(e.to_node_id)
  }

  // BFS to assign rank (layer) to each node
  const rank = {}
  const queue = nodes.filter(n => inDeg[n.id] === 0).map(n => n.id)
  queue.forEach(id => { rank[id] = 0 })

  let head = 0
  while (head < queue.length) {
    const cur = queue[head++]
    for (const nxt of (outEdges[cur] ?? [])) {
      const r = (rank[cur] ?? 0) + 1
      if (rank[nxt] === undefined || rank[nxt] < r) {
        rank[nxt] = r
        queue.push(nxt)
      }
    }
  }

  // Assign any unranked nodes to rank 0
  nodes.forEach(n => { if (rank[n.id] === undefined) rank[n.id] = 0 })

  // Group by rank
  const byRank = {}
  nodes.forEach(n => {
    const r = rank[n.id]
    if (!byRank[r]) byRank[r] = []
    byRank[r].push(n.id)
  })

  const maxRank = Math.max(...Object.keys(byRank).map(Number))
  const maxPerRank = Math.max(...Object.values(byRank).map(a => a.length))

  const totalW = PAD * 2 + (maxRank + 1) * NODE_W + maxRank * COL_GAP
  const totalH = PAD * 2 + maxPerRank * NODE_H + (maxPerRank - 1) * ROW_GAP

  const positions = {}
  for (const [r, ids] of Object.entries(byRank)) {
    const rNum  = parseInt(r)
    const x     = PAD + rNum * (NODE_W + COL_GAP)
    const colH  = ids.length * NODE_H + (ids.length - 1) * ROW_GAP
    const yStart = PAD + (totalH - PAD * 2 - colH) / 2
    ids.forEach((id, i) => {
      positions[id] = { x, y: yStart + i * (NODE_H + ROW_GAP) }
    })
  }

  return { positions, width: totalW, height: Math.max(totalH, NODE_H + PAD * 2) }
}

function LineageDAG({ nodes, edges, onNodeClick }) {
  const [hovered, setHovered] = useState(null)
  const { positions, width, height } = computeLayout(nodes, edges)

  return (
    <div className="overflow-x-auto border border-gray-200 rounded bg-white">
      <svg width={width} height={height} xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arr" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <polygon points="0 0, 8 3, 0 6" fill="#6366f1" />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map(e => {
          const from = positions[e.from_node_id]
          const to   = positions[e.to_node_id]
          if (!from || !to) return null
          const x1 = from.x + NODE_W
          const y1 = from.y + NODE_H / 2
          const x2 = to.x
          const y2 = to.y + NODE_H / 2
          const cx  = (x1 + x2) / 2
          return (
            <path
              key={e.id}
              d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={hovered === e.from_node_id || hovered === e.to_node_id ? '#4f46e5' : '#c7d2fe'}
              strokeWidth={hovered === e.from_node_id || hovered === e.to_node_id ? 2 : 1.5}
              markerEnd="url(#arr)"
            />
          )
        })}

        {/* Nodes */}
        {nodes.map(n => {
          const pos    = positions[n.id]
          if (!pos) return null
          const colors  = CLASS_COLORS[n.data_classification] ?? CLASS_COLORS.unknown
          const isHov   = hovered === n.id
          const icon    = TYPE_ICONS[n.node_type] ?? '•'
          const label   = n.node_name ?? n.node_id ?? n.service_name ?? '?'
          const sublabel = n.node_type?.replace('_', ' ')

          return (
            <g
              key={n.id}
              transform={`translate(${pos.x},${pos.y})`}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onNodeClick?.(n)}
              style={{ cursor: onNodeClick ? 'pointer' : 'default' }}
            >
              <rect
                width={NODE_W}
                height={NODE_H}
                rx={8}
                fill={colors.fill}
                stroke={isHov ? colors.stroke : '#e5e7eb'}
                strokeWidth={isHov ? 2 : 1}
                filter={isHov ? 'drop-shadow(0 2px 6px rgba(0,0,0,0.12))' : undefined}
              />
              {/* Icon */}
              <text x={14} y={26} fontSize={16} dominantBaseline="middle">{icon}</text>
              {/* External badge */}
              {n.is_external && (
                <rect x={NODE_W - 22} y={6} width={16} height={14} rx={4} fill="#fee2e2" />
              )}
              {n.is_external && (
                <text x={NODE_W - 14} y={13} fontSize={9} fill="#dc2626" textAnchor="middle" dominantBaseline="middle">ext</text>
              )}
              {/* Name */}
              <text
                x={34} y={22}
                fontSize={11}
                fontWeight="600"
                fill={colors.text}
                dominantBaseline="middle"
              >
                {label.length > 16 ? label.slice(0, 15) + '…' : label}
              </text>
              {/* Sub-label */}
              <text x={34} y={42} fontSize={10} fill="#6b7280" dominantBaseline="middle">
                {sublabel}
              </text>
              {/* Region */}
              {n.data_region && (
                <text x={NODE_W - 6} y={NODE_H - 8} fontSize={9} fill="#9ca3af" textAnchor="end">
                  {n.data_region}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ── Node detail modal ─────────────────────────────────────────────────────────
// The practical flow this exists for: a PII-to-external-model lineage node
// is rarely actionable on its own — "4 calls to good-model" doesn't say
// which n8n workflow run or node caused them. When the node's telemetry
// carried n8n's own execution id/node name (see
// db/migrations/ai_inference/005_n8n_execution_linkage.sql), this surfaces
// the workflow/execution/node directly and links out to the live n8n
// execution so a reviewer can go straight to the workflow canvas that ran it.
function NodeDetailModal({ node, onClose }) {
  const icon = TYPE_ICONS[node.node_type] ?? '•'

  return (
    <Modal title="Lineage Node" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <div>
            <div className="font-semibold text-gray-900">{node.node_name ?? node.node_id}</div>
            <div className="text-xs text-gray-500 capitalize">{node.node_type?.replace('_', ' ')} · {node.service_name}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge variant={CLASS_VARIANT[node.data_classification] ?? 'default'}>{node.data_classification}</Badge>
          {node.is_external && (
            <Badge variant="danger"><ExternalLink size={10} className="mr-1" />External processor</Badge>
          )}
          {node.data_region && <Badge variant="default">{node.data_region}</Badge>}
        </div>

        {node.n8n ? (
          <div className="border border-gray-200 rounded-lg p-3 space-y-2 bg-gray-50">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">n8n execution</div>
            <dl className="text-sm space-y-1">
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Workflow</dt>
                <dd className="text-gray-800 font-medium text-right">{node.n8n.workflow_name ?? node.n8n.workflow_id ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-gray-500">Execution</dt>
                <dd className="text-gray-800 font-mono text-right">#{node.n8n.execution_id}</dd>
              </div>
              {node.n8n.node_name && (
                <div className="flex justify-between gap-3">
                  <dt className="text-gray-500">Node</dt>
                  <dd className="text-gray-800 font-medium text-right">{node.n8n.node_name}</dd>
                </div>
              )}
            </dl>
            {node.n8n.execution_url ? (
              <a
                href={node.n8n.execution_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-indigo-600 hover:text-indigo-800 mt-1"
              >
                <ExternalLink size={14} /> Open in n8n
              </a>
            ) : (
              <p className="text-xs text-gray-400">N8N_BASE_URL not configured — can't build a deep link.</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400">
            No n8n execution linked to this node — it either predates the linkage feature or wasn't triggered from an instrumented n8n node.
          </p>
        )}
      </div>
    </Modal>
  )
}

// ── Chain detail panel ────────────────────────────────────────────────────────

function ChainDetail({ correlationId, onClose }) {
  const qc = useQueryClient()
  const [selectedNode, setSelectedNode] = useState(null)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['lineage-chain', correlationId],
    queryFn:  () => lineage.getChain(correlationId),
  })

  const rebuildMut = useMutation({
    mutationFn: () => lineage.buildChain(correlationId),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['lineage-chain', correlationId] })
      qc.invalidateQueries({ queryKey: ['lineage-chains'] })
    },
  })

  if (isLoading) return <p className="text-sm text-gray-400 py-4">Loading chain…</p>
  if (isError)   return <p className="text-sm text-red-500 py-4">Failed to load lineage graph.</p>

  const { nodes = [], edges = [] } = data ?? {}
  const hasExternal     = nodes.some(n => n.is_external)
  const regions         = [...new Set(nodes.map(n => n.data_region).filter(Boolean))]
  const hasCrossBorder  = regions.length > 1
  const classifications = [...new Set(nodes.map(n => n.data_classification))]

  return (
    <div className="space-y-4">
      {/* Chain summary */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-xs text-gray-500">{correlationId}</span>
        {classifications.map(c => (
          <Badge key={c} variant={CLASS_VARIANT[c] ?? 'default'}>{c}</Badge>
        ))}
        {hasExternal && (
          <Badge variant="danger"><ExternalLink size={10} className="mr-1" />External processor</Badge>
        )}
        {hasCrossBorder && (
          <Badge variant="danger"><AlertTriangle size={10} className="mr-1" />Cross-border: {regions.join(' → ')}</Badge>
        )}
        <Button size="sm" variant="secondary" onClick={() => rebuildMut.mutate()} disabled={rebuildMut.isPending}>
          <RefreshCw size={12} className={rebuildMut.isPending ? 'animate-spin mr-1' : 'mr-1'} /> Rebuild
        </Button>
        <button onClick={onClose} className="ml-auto text-gray-400 hover:text-gray-600 text-xs">Close</button>
      </div>

      {/* DAG */}
      {nodes.length > 0
        ? <LineageDAG nodes={nodes} edges={edges} onNodeClick={setSelectedNode} />
        : <p className="text-sm text-gray-400">No lineage nodes found. Click Rebuild to derive from telemetry.</p>
      }

      {/* Node table */}
      {nodes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wide text-left">
                <th className="pb-1 pr-4">Node</th>
                <th className="pb-1 pr-4">Type</th>
                <th className="pb-1 pr-4">Service</th>
                <th className="pb-1 pr-4">Classification</th>
                <th className="pb-1 pr-4">Region</th>
                <th className="pb-1">External</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map(n => (
                <tr key={n.id} className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" onClick={() => setSelectedNode(n)}>
                  <td className="py-1.5 pr-4 font-medium text-gray-800">{n.node_name ?? n.node_id}</td>
                  <td className="py-1.5 pr-4 text-gray-500 capitalize">{n.node_type?.replace('_', ' ')}</td>
                  <td className="py-1.5 pr-4 font-mono text-gray-400">{n.service_name}</td>
                  <td className="py-1.5 pr-4">
                    <Badge variant={CLASS_VARIANT[n.data_classification] ?? 'default'}>
                      {n.data_classification}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-4 text-gray-400">{n.data_region ?? '—'}</td>
                  <td className="py-1.5">
                    {n.is_external
                      ? <span className="text-red-500 font-semibold">Yes</span>
                      : <span className="text-gray-300">No</span>
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedNode && <NodeDetailModal node={selectedNode} onClose={() => setSelectedNode(null)} />}
    </div>
  )
}

// ── Chain list row ────────────────────────────────────────────────────────────

function ChainRow({ chain, expanded, onToggle }) {
  const Chevron = expanded ? ChevronDown : ChevronRight

  const hasExternal    = chain.external_count > 0
  const hasCrossBorder = (chain.regions ?? []).length > 1
  const hasWarning     = hasExternal || hasCrossBorder

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer border-b border-gray-100"
        onClick={onToggle}
      >
        <td className="px-4 py-3"><Chevron size={14} className="text-gray-400" /></td>
        <td className="px-4 py-3 font-mono text-xs text-indigo-700 max-w-xs truncate">
          {chain.correlation_id}
        </td>
        <td className="px-4 py-3 text-sm text-gray-700">{chain.node_count}</td>
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {(chain.classifications ?? []).map(c => (
              <Badge key={c} variant={CLASS_VARIANT[c] ?? 'default'} className="text-xs">{c}</Badge>
            ))}
          </div>
        </td>
        <td className="px-4 py-3">
          {hasWarning ? (
            <span className="flex items-center gap-1 text-red-500 text-xs font-medium">
              <AlertTriangle size={12} />
              {hasExternal && 'External'}
              {hasCrossBorder && (hasExternal ? ', Cross-border' : 'Cross-border')}
            </span>
          ) : (
            <span className="text-xs text-gray-400">—</span>
          )}
        </td>
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          {chain.chain_start ? new Date(chain.chain_start).toLocaleString() : '—'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} className="px-6 py-4 bg-gray-50 border-b border-gray-200">
            <ChainDetail
              correlationId={chain.correlation_id}
              onClose={onToggle}
            />
          </td>
        </tr>
      )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Lineage() {
  const qc = useQueryClient()
  const [manualCid, setManualCid] = useState('')
  const [expandedId, setExpandedId] = useState(null)

  const { data: chains = [], isLoading } = useQuery({
    queryKey: ['lineage-chains'],
    queryFn:  () => lineage.listChains({ limit: 50 }),
    refetchInterval: 60_000,
  })

  const { data: violations = [] } = useQuery({
    queryKey: ['lineage-violations'],
    queryFn:  lineage.listViolations,
  })

  const buildMut = useMutation({
    mutationFn: (cid) => lineage.buildChain(cid),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['lineage-chains'] })
      setManualCid('')
    },
  })

  const hasExternal   = chains.some(c => c.external_count > 0)
  const hasCrossBorder = chains.some(c => (c.regions ?? []).length > 1)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Share2 size={20} className="text-indigo-600 mt-0.5" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">Data Lineage</h1>
            <p className="text-xs text-gray-500">Where information originates, travels, transforms, and exits org boundaries</p>
          </div>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card><CardContent className="py-4 px-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Chains</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{chains.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-4 px-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Violations</p>
          <p className={`text-2xl font-bold mt-1 ${violations.length ? 'text-red-600' : 'text-gray-800'}`}>
            {violations.length}
          </p>
        </CardContent></Card>
        <Card><CardContent className="py-4 px-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">External Processors</p>
          <p className={`text-2xl font-bold mt-1 ${hasExternal ? 'text-orange-500' : 'text-gray-800'}`}>
            {chains.reduce((s, c) => s + (c.external_count ?? 0), 0)}
          </p>
        </CardContent></Card>
        <Card><CardContent className="py-4 px-5">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Cross-border</p>
          <p className={`text-2xl font-bold mt-1 ${hasCrossBorder ? 'text-red-600' : 'text-gray-800'}`}>
            {chains.filter(c => (c.regions ?? []).length > 1).length}
          </p>
        </CardContent></Card>
      </div>

      {/* Violations banner */}
      {violations.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-3 px-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-red-500" />
              <span className="text-sm font-semibold text-red-700">{violations.length} lineage violation{violations.length !== 1 ? 's' : ''}</span>
            </div>
            <div className="space-y-1">
              {/* entity_id on a lineage violation is the chain's correlation_id
                  (see services/governance-service/src/lib/rule-evaluator.js's
                  lineage evaluator) — clicking jumps straight to that chain
                  instead of making the user search the table for it. */}
              {violations.slice(0, 3).map(v => (
                <button
                  key={v.id}
                  onClick={() => setExpandedId(v.entity_id)}
                  className="block text-xs text-red-600 hover:text-red-800 hover:underline text-left"
                >
                  {v.message}
                </button>
              ))}
              {violations.length > 3 && (
                <p className="text-xs text-red-400">…and {violations.length - 3} more</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Manual build */}
      <div className="flex gap-2 items-center">
        <input
          value={manualCid}
          onChange={e => setManualCid(e.target.value)}
          placeholder="correlation ID — build lineage from telemetry chain"
          className="flex-1 text-sm border border-gray-300 rounded px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />
        <Button
          size="sm"
          variant="primary"
          onClick={() => buildMut.mutate(manualCid.trim())}
          disabled={!manualCid.trim() || buildMut.isPending}
        >
          {buildMut.isPending ? 'Building…' : 'Build'}
        </Button>
      </div>
      {buildMut.isError && <p className="text-xs text-red-500">{buildMut.error?.message}</p>}
      {buildMut.isSuccess && <p className="text-xs text-green-600">Chain built — expand it below.</p>}

      {/* Chain table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                <th className="px-4 pb-3 w-6"></th>
                <th className="px-4 pb-3">Correlation ID</th>
                <th className="px-4 pb-3">Nodes</th>
                <th className="px-4 pb-3">Data Classes</th>
                <th className="px-4 pb-3">Findings</th>
                <th className="px-4 pb-3">Chain Start</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={6} className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</td></tr>
              )}
              {!isLoading && chains.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center">
                    <p className="text-sm text-gray-400">No lineage chains recorded yet.</p>
                    <p className="text-xs text-gray-400 mt-1">Lineage is built automatically when telemetry events with correlation IDs are ingested.</p>
                  </td>
                </tr>
              )}
              {chains.map(chain => (
                <ChainRow
                  key={chain.correlation_id}
                  chain={chain}
                  expanded={expandedId === chain.correlation_id}
                  onToggle={() => setExpandedId(id => id === chain.correlation_id ? null : chain.correlation_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
