import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { tags as tagsApi } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Table, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input, Label, Select } from '../../components/ui/Input'
import { useConfirm } from '../../hooks/useConfirm.jsx'

const ROLE_VARIANT = { governance: 'danger', folder: 'info', general: 'default' }
const ROLE_LABEL   = { governance: 'Governance', folder: 'Folder', general: 'General' }

const COLOR_PRESETS = [
  { label: 'Red',    value: 'bg-red-100 text-red-700' },
  { label: 'Orange', value: 'bg-orange-100 text-orange-700' },
  { label: 'Yellow', value: 'bg-yellow-100 text-yellow-700' },
  { label: 'Green',  value: 'bg-green-100 text-green-700' },
  { label: 'Blue',   value: 'bg-blue-100 text-blue-700' },
  { label: 'Indigo', value: 'bg-indigo-100 text-indigo-700' },
  { label: 'Purple', value: 'bg-purple-100 text-purple-700' },
  { label: 'Gray',   value: 'bg-gray-100 text-gray-600' },
]

function TagPreview({ name, color }) {
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color || 'bg-gray-100 text-gray-600'}`}>
      {name || 'preview'}
    </span>
  )
}

// ── Inline edit row ────────────────────────────────────────────────────────
function EditRow({ tag, onSave, onCancel }) {
  const [form, setForm] = useState({
    name:        tag.name,
    role:        tag.role,
    risk_score:  tag.risk_score ?? '',
    color:       tag.color ?? '',
    description: tag.description ?? '',
  })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <Tr>
      <Td>
        <Input value={form.name} onChange={set('name')} className="w-36" />
      </Td>
      <Td>
        <Select value={form.role} onChange={set('role')} className="w-32">
          <option value="folder">Folder</option>
          <option value="governance">Governance</option>
          <option value="general">General</option>
        </Select>
      </Td>
      <Td>
        {form.role === 'governance'
          ? <Input type="number" min="0" max="100" value={form.risk_score} onChange={set('risk_score')} className="w-20" />
          : <span className="text-xs text-gray-300">—</span>}
      </Td>
      <Td>
        <Select value={form.color} onChange={set('color')} className="w-28">
          <option value="">None</option>
          {COLOR_PRESETS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </Td>
      <Td><TagPreview name={form.name} color={form.color} /></Td>
      <Td>
        <Input value={form.description} onChange={set('description')} className="w-48" placeholder="optional" />
      </Td>
      <Td>
        <div className="flex gap-1">
          <button onClick={() => onSave({
            ...form,
            risk_score: form.risk_score !== '' ? Number(form.risk_score) : null,
          })} className="text-green-600 hover:text-green-700 p-0.5"><Check size={14} /></button>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
        </div>
      </Td>
    </Tr>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export function TagAdmin() {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [editingId, setEditingId] = useState(null)
  const [showAdd,   setShowAdd]   = useState(false)
  const [addForm,   setAddForm]   = useState({ name: '', role: 'folder', risk_score: '', color: '', description: '' })
  const setAdd = k => e => setAddForm(f => ({ ...f, [k]: e.target.value }))

  const { data: tagList = [], isLoading } = useQuery({
    queryKey: ['tags'],
    queryFn:  tagsApi.list,
  })

  const create = useMutation({
    mutationFn: tagsApi.create,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['tags'] })
      setShowAdd(false)
      setAddForm({ name: '', role: 'folder', risk_score: '', color: '', description: '' })
    },
  })

  const update = useMutation({
    mutationFn: ({ id, ...body }) => tagsApi.update(id, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['tags'] }); setEditingId(null) },
  })

  const remove = useMutation({
    mutationFn: tagsApi.remove,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['tags'] }),
  })

  // Group for display: governance first, then folder, then general
  const grouped = ['governance', 'folder', 'general'].flatMap(role =>
    tagList.filter(t => t.role === role)
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Tag Registry</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Define tag roles and risk scores. <strong>Folder</strong> tags group workflows in the import picker and workflow list.{' '}
            <strong>Governance</strong> tags carry a risk score that feeds into workflow risk analysis.
          </p>
        </div>
        <Button onClick={() => setShowAdd(v => !v)}>
          <Plus size={15} />{showAdd ? 'Cancel' : 'Add Tag'}
        </Button>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th>Name</Th>
            <Th>Role</Th>
            <Th>Risk Score</Th>
            <Th>Color</Th>
            <Th>Preview</Th>
            <Th>Description</Th>
            <Th />
          </tr></thead>
          <tbody>

            {/* Add row */}
            {showAdd && (
              <Tr>
                <Td><Input value={addForm.name} onChange={setAdd('name')} placeholder="tag-name" className="w-36" autoFocus /></Td>
                <Td>
                  <Select value={addForm.role} onChange={setAdd('role')} className="w-32">
                    <option value="folder">Folder</option>
                    <option value="governance">Governance</option>
                    <option value="general">General</option>
                  </Select>
                </Td>
                <Td>
                  {addForm.role === 'governance'
                    ? <Input type="number" min="0" max="100" value={addForm.risk_score} onChange={setAdd('risk_score')} className="w-20" placeholder="0–100" />
                    : <span className="text-xs text-gray-300">—</span>}
                </Td>
                <Td>
                  <Select value={addForm.color} onChange={setAdd('color')} className="w-28">
                    <option value="">None</option>
                    {COLOR_PRESETS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </Select>
                </Td>
                <Td><TagPreview name={addForm.name} color={addForm.color} /></Td>
                <Td><Input value={addForm.description} onChange={setAdd('description')} placeholder="optional" className="w-48" /></Td>
                <Td>
                  <Button
                    size="sm"
                    disabled={!addForm.name || create.isPending}
                    onClick={() => create.mutate({
                      ...addForm,
                      risk_score: addForm.risk_score !== '' ? Number(addForm.risk_score) : null,
                    })}
                  >
                    {create.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  {create.error && <p className="text-xs text-red-600 mt-1">{create.error.message}</p>}
                </Td>
              </Tr>
            )}

            {isLoading && <tr><Td colSpan={7} className="text-center text-gray-400">Loading…</Td></tr>}

            {grouped.map(tag =>
              editingId === tag.id
                ? <EditRow
                    key={tag.id}
                    tag={tag}
                    onSave={body => update.mutate({ id: tag.id, ...body })}
                    onCancel={() => setEditingId(null)}
                  />
                : (
                  <Tr key={tag.id}>
                    <Td className="font-mono text-xs font-medium text-gray-800">{tag.name}</Td>
                    <Td><Badge variant={ROLE_VARIANT[tag.role]}>{ROLE_LABEL[tag.role]}</Badge></Td>
                    <Td className="tabular-nums text-sm">
                      {tag.role === 'governance' && tag.risk_score != null
                        ? <span className={`font-semibold ${tag.risk_score >= 80 ? 'text-red-600' : tag.risk_score >= 50 ? 'text-orange-500' : 'text-yellow-600'}`}>
                            {tag.risk_score}
                          </span>
                        : <span className="text-gray-300">—</span>}
                    </Td>
                    <Td>
                      {tag.color
                        ? <span className={`inline-block w-4 h-4 rounded ${tag.color.split(' ')[0]}`} title={tag.color} />
                        : <span className="text-gray-300 text-xs">—</span>}
                    </Td>
                    <Td><TagPreview name={tag.name} color={tag.color} /></Td>
                    <Td className="text-xs text-gray-400 max-w-xs truncate">{tag.description || '—'}</Td>
                    <Td>
                      <div className="flex gap-1.5">
                        <button onClick={() => setEditingId(tag.id)} className="text-gray-400 hover:text-indigo-600 p-0.5"><Pencil size={13} /></button>
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title:        'Delete Tag',
                              message:      `Remove the "${tag.name}" tag? This will not remove it from existing workflows.`,
                              confirmLabel: 'Delete Tag',
                            })
                            if (ok) remove.mutate(tag.id)
                          }}
                          className="text-gray-400 hover:text-red-500 p-0.5"
                        ><Trash2 size={13} /></button>
                      </div>
                    </Td>
                  </Tr>
                )
            )}

            {!isLoading && tagList.length === 0 && !showAdd && (
              <tr><Td colSpan={7} className="text-center text-gray-400 py-8">
                No tags defined. Add your first tag above.
              </Td></tr>
            )}
          </tbody>
        </Table>
      </Card>

      {dialog}
    </div>
  )
}
