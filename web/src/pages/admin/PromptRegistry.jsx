import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ScrollText, ChevronDown, ChevronRight, Plus, CheckCircle,
  XCircle, Clock, Archive, RotateCcw, ShieldCheck, X,
} from 'lucide-react'
import { Card, CardContent } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { promptRegistry } from '../../lib/api'
import { useAuth } from '../../components/AuthGuard'

// ── Constants ──────────────────────────────────────────────────────────────────

const TYPE_LABELS = {
  system:           'System',
  template:         'Template',
  guardrail:        'Guardrail',
  tool_description: 'Tool Desc',
}
const TYPE_VARIANT = {
  system:           'purple',
  template:         'info',
  guardrail:        'danger',
  tool_description: 'default',
}
const STATUS_VARIANT = {
  pending:    'warning',
  approved:   'success',
  denied:     'danger',
  deprecated: 'default',
}
const STATUS_ICON = {
  pending:    <Clock size={12} />,
  approved:   <CheckCircle size={12} />,
  denied:     <XCircle size={12} />,
  deprecated: <Archive size={12} />,
}

// ── Summary card ───────────────────────────────────────────────────────────────

function SummaryCard({ label, value, variant = 'default' }) {
  const colors = {
    default: 'text-gray-700',
    success: 'text-green-600',
    warning: 'text-yellow-600',
    danger:  'text-red-600',
  }
  return (
    <Card>
      <CardContent className="py-4 px-5">
        <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${colors[variant]}`}>{value}</p>
      </CardContent>
    </Card>
  )
}

// ── Version history ─────────────────────────────────────────────────────────────

function VersionHistory({ prompt, onRollback, canWrite }) {
  const versions = prompt.versions ?? []
  if (!versions.length) return <p className="text-xs text-gray-400">No version history.</p>

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 text-gray-400 uppercase tracking-wide text-left">
            <th className="pb-1 pr-4">Ver</th>
            <th className="pb-1 pr-4">Changed By</th>
            <th className="pb-1 pr-4">Date</th>
            <th className="pb-1 pr-8">Hash</th>
            {canWrite && <th className="pb-1"></th>}
          </tr>
        </thead>
        <tbody>
          {versions.map(v => (
            <tr key={v.id} className="border-b border-gray-50 hover:bg-gray-50">
              <td className="py-1.5 pr-4 font-mono font-semibold text-indigo-700">v{v.version}</td>
              <td className="py-1.5 pr-4 text-gray-600">{v.changed_by ?? '—'}</td>
              <td className="py-1.5 pr-4 text-gray-500 whitespace-nowrap">
                {new Date(v.changed_at).toLocaleString()}
              </td>
              <td className="py-1.5 pr-8 font-mono text-gray-400">{v.content_hash?.slice(0, 12)}…</td>
              {canWrite && v.version !== prompt.version && (
                <td className="py-1.5">
                  <button
                    onClick={() => onRollback(v.version)}
                    className="flex items-center gap-1 text-indigo-600 hover:text-indigo-800 transition-colors"
                  >
                    <RotateCcw size={11} /> Rollback
                  </button>
                </td>
              )}
              {canWrite && v.version === prompt.version && (
                <td className="py-1.5 text-gray-400 text-xs italic">current</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Expanded detail row ─────────────────────────────────────────────────────────

function ExpandedRow({ promptId, onClose, canWrite, onEdit }) {
  const qc = useQueryClient()
  const { data: prompt, isLoading } = useQuery({
    queryKey: ['prompt-registry', promptId],
    queryFn:  () => promptRegistry.get(promptId),
  })

  const approvalMut = useMutation({
    mutationFn: ({ status, by }) => promptRegistry.approval(promptId, { approval_status: status, approved_by: by }),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['prompt-registry'] }) },
  })

  const rollbackMut = useMutation({
    mutationFn: (version) => promptRegistry.rollback(promptId, version),
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['prompt-registry'] })
      qc.invalidateQueries({ queryKey: ['prompt-registry', promptId] })
    },
  })

  const { user } = useAuth()

  if (isLoading) return (
    <tr><td colSpan={7} className="px-6 py-4 text-sm text-gray-400">Loading…</td></tr>
  )
  if (!prompt) return null

  const models     = Array.isArray(prompt.approved_models) ? prompt.approved_models : []
  const dataClasses = Array.isArray(prompt.permitted_data_classes) ? prompt.permitted_data_classes : []

  return (
    <tr>
      <td colSpan={7} className="px-6 pb-5 bg-gray-50 border-b border-gray-200">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">

          {/* Left: content + metadata */}
          <div className="space-y-4">
            {prompt.purpose && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Purpose</p>
                <p className="text-sm text-gray-700">{prompt.purpose}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Content</p>
              <pre className="text-xs text-gray-700 bg-white border border-gray-200 rounded p-3 whitespace-pre-wrap max-h-40 overflow-y-auto font-mono">
                {prompt.content}
              </pre>
            </div>
            <div className="flex gap-8">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Approved Models</p>
                {models.length
                  ? <div className="flex flex-wrap gap-1">{models.map(m => <Badge key={m} variant="info">{m}</Badge>)}</div>
                  : <p className="text-xs text-gray-400">None specified</p>
                }
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Permitted Data Classes</p>
                {dataClasses.length
                  ? <div className="flex flex-wrap gap-1">{dataClasses.map(d => <Badge key={d} variant="purple">{d}</Badge>)}</div>
                  : <p className="text-xs text-gray-400">None specified</p>
                }
              </div>
            </div>
            <div>
              <p className="text-xs font-mono text-gray-400">
                Hash: {prompt.content_hash?.slice(0, 16)}… &nbsp;|&nbsp; v{prompt.version}
              </p>
            </div>
          </div>

          {/* Right: version history + actions */}
          <div className="space-y-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Version History</p>
              <VersionHistory
                prompt={prompt}
                canWrite={canWrite}
                onRollback={v => rollbackMut.mutate(v)}
              />
            </div>

            {canWrite && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                <Button size="sm" variant="secondary" onClick={() => onEdit(prompt)}>
                  Edit Content
                </Button>
                {prompt.approval_status === 'pending' && (
                  <>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => approvalMut.mutate({ status: 'approved', by: user?.username })}
                      disabled={approvalMut.isPending}
                    >
                      <ShieldCheck size={13} className="mr-1" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => approvalMut.mutate({ status: 'denied', by: user?.username })}
                      disabled={approvalMut.isPending}
                    >
                      <XCircle size={13} className="mr-1" /> Deny
                    </Button>
                  </>
                )}
                {prompt.approval_status === 'approved' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => approvalMut.mutate({ status: 'deprecated', by: user?.username })}
                    disabled={approvalMut.isPending}
                  >
                    <Archive size={13} className="mr-1" /> Deprecate
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>
      </td>
    </tr>
  )
}

// ── Prompt row ─────────────────────────────────────────────────────────────────

function PromptRow({ prompt, canWrite, onEdit }) {
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <>
      <tr
        className="hover:bg-gray-50 cursor-pointer border-b border-gray-100"
        onClick={() => setExpanded(e => !e)}
      >
        <td className="px-4 py-3">
          <Chevron size={14} className="text-gray-400" />
        </td>
        <td className="px-4 py-3">
          <span className="text-sm font-medium text-gray-900">{prompt.name}</span>
        </td>
        <td className="px-4 py-3">
          <Badge variant={TYPE_VARIANT[prompt.type] ?? 'default'}>
            {TYPE_LABELS[prompt.type] ?? prompt.type}
          </Badge>
        </td>
        <td className="px-4 py-3">
          <span className="flex items-center gap-1">
            <Badge variant={STATUS_VARIANT[prompt.approval_status] ?? 'default'}>
              {STATUS_ICON[prompt.approval_status]}
              <span className="ml-1 capitalize">{prompt.approval_status}</span>
            </Badge>
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-gray-600 font-mono">v{prompt.version}</td>
        <td className="px-4 py-3 text-sm text-gray-500">{prompt.owner ?? '—'}</td>
        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
          {new Date(prompt.updated_at).toLocaleDateString()}
        </td>
      </tr>
      {expanded && (
        <ExpandedRow
          promptId={prompt.id}
          canWrite={canWrite}
          onEdit={onEdit}
          onClose={() => setExpanded(false)}
        />
      )}
    </>
  )
}

// ── Create / Edit form ──────────────────────────────────────────────────────────

const EMPTY_FORM = { name: '', type: 'system', content: '', owner: '', purpose: '', approved_models: '', permitted_data_classes: '' }

function PromptForm({ initial, onSave, onCancel, isSaving }) {
  const [form, setForm] = useState(initial ?? EMPTY_FORM)
  const isEdit = !!initial

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = (e) => {
    e.preventDefault()
    const models      = form.approved_models.split(',').map(s => s.trim()).filter(Boolean)
    const dataClasses = form.permitted_data_classes.split(',').map(s => s.trim()).filter(Boolean)
    onSave({
      name:                    form.name,
      type:                    form.type,
      content:                 form.content,
      owner:                   form.owner || undefined,
      purpose:                 form.purpose || undefined,
      approved_models:         models,
      permitted_data_classes:  dataClasses,
    })
  }

  return (
    <Card className="mb-6">
      <CardContent className="pt-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-800">
            {isEdit ? `Edit: ${initial.name}` : 'New Prompt'}
          </h3>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!isEdit && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
                <Input value={form.name} onChange={set('name')} placeholder="e.g. system-safety-guardrail" required />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Type *</label>
              <select
                value={form.type}
                onChange={set('type')}
                className="w-full text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                required
              >
                <option value="system">System</option>
                <option value="template">Template</option>
                <option value="guardrail">Guardrail</option>
                <option value="tool_description">Tool Description</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Owner</label>
              <Input value={form.owner} onChange={set('owner')} placeholder="team or person" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Purpose</label>
            <textarea
              value={form.purpose}
              onChange={set('purpose')}
              rows={2}
              placeholder="Describe what this prompt is for…"
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Content *</label>
            <textarea
              value={form.content}
              onChange={set('content')}
              rows={6}
              placeholder="Paste the full prompt text here…"
              className="w-full text-sm border border-gray-300 rounded px-3 py-2 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-400"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Approved Models <span className="text-gray-400">(comma-separated)</span></label>
              <Input value={form.approved_models} onChange={set('approved_models')} placeholder="gpt-4o, claude-sonnet-5" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Permitted Data Classes <span className="text-gray-400">(comma-separated)</span></label>
              <Input value={form.permitted_data_classes} onChange={set('permitted_data_classes')} placeholder="internal, public" />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Button type="submit" variant="primary" size="sm" disabled={isSaving}>
              {isSaving ? 'Saving…' : isEdit ? 'Save New Version' : 'Create Prompt'}
            </Button>
            <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}

// ── Main page ───────────────────────────────────────────────────────────────────

export function PromptRegistry() {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  // Backend gates prompt create/edit/rollback on mcp:register (see
  // mcp-governance-service's routes/prompt-registry.js), not a generic
  // write flag — canWrite here previously checked the literal 'write'
  // permission from the pre-EP-308 coarse model, which no role is ever
  // granted anymore, hiding these controls for every user including admins.
  const canWrite = hasPermission('mcp:register')

  const [filterType,   setFilterType]   = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [showForm,     setShowForm]     = useState(false)
  const [editTarget,   setEditTarget]   = useState(null)

  const { data: prompts = [], isLoading } = useQuery({
    queryKey: ['prompt-registry'],
    queryFn:  promptRegistry.list,
  })

  const createMut = useMutation({
    mutationFn: promptRegistry.create,
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['prompt-registry'] }); setShowForm(false) },
  })
  const updateMut = useMutation({
    mutationFn: ({ id, body }) => promptRegistry.update(id, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['prompt-registry'] }); setEditTarget(null) },
  })

  const filtered = prompts.filter(p =>
    (!filterType   || p.type === filterType) &&
    (!filterStatus || p.approval_status === filterStatus)
  )

  const counts = {
    total:      prompts.length,
    approved:   prompts.filter(p => p.approval_status === 'approved').length,
    pending:    prompts.filter(p => p.approval_status === 'pending').length,
    deprecated: prompts.filter(p => p.approval_status === 'deprecated').length,
  }

  const handleEdit = (prompt) => {
    setEditTarget({
      ...EMPTY_FORM,
      id:                   prompt.id,
      name:                 prompt.name,
      type:                 prompt.type,
      content:              prompt.content,
      owner:                prompt.owner ?? '',
      purpose:              prompt.purpose ?? '',
      approved_models:      (prompt.approved_models ?? []).join(', '),
      permitted_data_classes: (prompt.permitted_data_classes ?? []).join(', '),
    })
    setShowForm(false)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ScrollText size={20} className="text-indigo-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Prompt Registry</h2>
            <p className="text-xs text-gray-500">Governed prompt templates with approval lifecycle and drift detection</p>
          </div>
        </div>
        {canWrite && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => { setShowForm(s => !s); setEditTarget(null) }}
          >
            <Plus size={14} className="mr-1" /> New Prompt
          </Button>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SummaryCard label="Total"      value={counts.total} />
        <SummaryCard label="Approved"   value={counts.approved}   variant="success" />
        <SummaryCard label="Pending"    value={counts.pending}    variant="warning" />
        <SummaryCard label="Deprecated" value={counts.deprecated} variant="default" />
      </div>

      {/* Create form */}
      {showForm && canWrite && (
        <PromptForm
          onSave={(body) => createMut.mutate(body)}
          onCancel={() => setShowForm(false)}
          isSaving={createMut.isPending}
        />
      )}

      {/* Edit form */}
      {editTarget && canWrite && (
        <PromptForm
          initial={editTarget}
          onSave={(body) => updateMut.mutate({ id: editTarget.id, body })}
          onCancel={() => setEditTarget(null)}
          isSaving={updateMut.isPending}
        />
      )}

      {/* Error banners */}
      {createMut.isError && (
        <p className="text-sm text-red-600">Error: {createMut.error?.message}</p>
      )}
      {updateMut.isError && (
        <p className="text-sm text-red-600">Error: {updateMut.error?.message}</p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          value={filterType}
          onChange={e => setFilterType(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">All types</option>
          <option value="system">System</option>
          <option value="template">Template</option>
          <option value="guardrail">Guardrail</option>
          <option value="tool_description">Tool Description</option>
        </select>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        >
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="denied">Denied</option>
          <option value="deprecated">Deprecated</option>
        </select>
        {(filterType || filterStatus) && (
          <button
            onClick={() => { setFilterType(''); setFilterStatus('') }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Clear filters
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} prompt{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide text-left">
                <th className="px-4 pb-3 w-6"></th>
                <th className="px-4 pb-3">Name</th>
                <th className="px-4 pb-3">Type</th>
                <th className="px-4 pb-3">Status</th>
                <th className="px-4 pb-3">Version</th>
                <th className="px-4 pb-3">Owner</th>
                <th className="px-4 pb-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={7} className="px-4 py-6 text-sm text-gray-400 text-center">Loading…</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center">
                    <p className="text-sm text-gray-400">No prompts registered yet.</p>
                    {canWrite && (
                      <p className="text-xs text-gray-400 mt-1">
                        Click <strong>New Prompt</strong> to add the first entry.
                      </p>
                    )}
                  </td>
                </tr>
              )}
              {filtered.map(prompt => (
                <PromptRow
                  key={prompt.id}
                  prompt={prompt}
                  canWrite={canWrite}
                  onEdit={handleEdit}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
