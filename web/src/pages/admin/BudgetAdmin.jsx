import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Archive, Pencil, Check, X } from 'lucide-react'
import { budgets as budgetsApi } from '../../lib/api'
import { Card } from '../../components/ui/Card'
import { Table, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input, Select } from '../../components/ui/Input'
import { useConfirm } from '../../hooks/useConfirm.jsx'

const SCOPE_TYPES = ['model_id', 'user_id', 'service_id', 'workflow_id']
const PERIODS = ['daily', 'monthly']
const MODES = ['soft', 'hard']
const MODE_VARIANT = { soft: 'info', hard: 'danger' }

const EMPTY_FORM = { scope_type: 'user_id', scope_value: '', period: 'monthly', limit_usd: '', mode: 'soft' }

// ── Inline edit row — scope_type is immutable after creation (design.md D2) ──
function EditRow({ budget, onSave, onCancel }) {
  const [form, setForm] = useState({
    scope_value: budget.scope_value,
    period:      budget.period,
    limit_usd:   budget.limit_usd,
    mode:        budget.mode,
  })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <Tr>
      <Td className="font-mono text-xs">{budget.scope_type}<span className="text-gray-300"> (fixed)</span></Td>
      <Td><Input value={form.scope_value} onChange={set('scope_value')} className="w-36" /></Td>
      <Td>
        <Select value={form.period} onChange={set('period')} className="w-24">
          {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
      </Td>
      <Td><Input type="number" min="0" step="0.01" value={form.limit_usd} onChange={set('limit_usd')} className="w-24" /></Td>
      <Td>
        <Select value={form.mode} onChange={set('mode')} className="w-24">
          {MODES.map(m => <option key={m} value={m}>{m}</option>)}
        </Select>
      </Td>
      <Td>
        <div className="flex gap-1">
          <button onClick={() => onSave(form)} className="text-green-600 hover:text-green-700 p-0.5"><Check size={14} /></button>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 p-0.5"><X size={14} /></button>
        </div>
      </Td>
    </Tr>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export function BudgetAdmin() {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [editingId, setEditingId] = useState(null)
  const [showAdd,   setShowAdd]   = useState(false)
  const [addForm,   setAddForm]   = useState(EMPTY_FORM)
  const setAdd = k => e => setAddForm(f => ({ ...f, [k]: e.target.value }))

  const { data: budgetList = [], isLoading } = useQuery({
    queryKey: ['budgets'],
    queryFn:  () => budgetsApi.list(),
  })

  const create = useMutation({
    mutationFn: budgetsApi.create,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
    },
  })

  const update = useMutation({
    mutationFn: ({ id, ...body }) => budgetsApi.update(id, body),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['budgets'] }); setEditingId(null) },
  })

  const archive = useMutation({
    mutationFn: budgetsApi.archive,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Usage Budgets</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Spend/token caps per model, user, service, or workflow. <strong>Soft</strong> budgets
            warn and file an incident on breach without blocking. <strong>Hard</strong> budgets
            also block new inference requests once breached.
          </p>
        </div>
        <Button onClick={() => setShowAdd(v => !v)}>
          <Plus size={15} />{showAdd ? 'Cancel' : 'Add Budget'}
        </Button>
      </div>

      <Card>
        <Table>
          <thead><tr>
            <Th>Scope Type</Th>
            <Th>Scope Value</Th>
            <Th>Period</Th>
            <Th>Limit (USD)</Th>
            <Th>Mode</Th>
            <Th />
          </tr></thead>
          <tbody>

            {showAdd && (
              <Tr>
                <Td>
                  <Select value={addForm.scope_type} onChange={setAdd('scope_type')} className="w-28">
                    {SCOPE_TYPES.map(s => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </Td>
                <Td><Input value={addForm.scope_value} onChange={setAdd('scope_value')} placeholder="e.g. team-x" className="w-36" autoFocus /></Td>
                <Td>
                  <Select value={addForm.period} onChange={setAdd('period')} className="w-24">
                    {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </Td>
                <Td><Input type="number" min="0" step="0.01" value={addForm.limit_usd} onChange={setAdd('limit_usd')} placeholder="100.00" className="w-24" /></Td>
                <Td>
                  <Select value={addForm.mode} onChange={setAdd('mode')} className="w-24">
                    {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </Select>
                </Td>
                <Td>
                  <Button
                    size="sm"
                    disabled={!addForm.scope_value || !addForm.limit_usd || create.isPending}
                    onClick={() => create.mutate({ ...addForm, limit_usd: Number(addForm.limit_usd) })}
                  >
                    {create.isPending ? 'Saving…' : 'Save'}
                  </Button>
                  {create.error && <p className="text-xs text-red-600 mt-1">{create.error.message}</p>}
                </Td>
              </Tr>
            )}

            {isLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}

            {budgetList.map(budget =>
              editingId === budget.id
                ? <EditRow
                    key={budget.id}
                    budget={budget}
                    onSave={body => update.mutate({ id: budget.id, ...body, limit_usd: Number(body.limit_usd) })}
                    onCancel={() => setEditingId(null)}
                  />
                : (
                  <Tr key={budget.id}>
                    <Td className="font-mono text-xs">{budget.scope_type}</Td>
                    <Td className="font-mono text-xs font-medium text-gray-800">{budget.scope_value}</Td>
                    <Td className="text-sm text-gray-600">{budget.period}</Td>
                    <Td className="tabular-nums text-sm font-semibold">${Number(budget.limit_usd).toFixed(2)}</Td>
                    <Td><Badge variant={MODE_VARIANT[budget.mode]}>{budget.mode}</Badge></Td>
                    <Td>
                      <div className="flex gap-1.5">
                        <button onClick={() => setEditingId(budget.id)} className="text-gray-400 hover:text-indigo-600 p-0.5"><Pencil size={13} /></button>
                        <button
                          onClick={async () => {
                            const ok = await confirm({
                              title:        'Archive Budget',
                              message:      `Archive the budget for ${budget.scope_type}=${budget.scope_value}? It stops being enforced immediately but its history is kept, not deleted.`,
                              confirmLabel: 'Archive Budget',
                            })
                            if (ok) archive.mutate(budget.id)
                          }}
                          className="text-gray-400 hover:text-red-500 p-0.5"
                        ><Archive size={13} /></button>
                      </div>
                    </Td>
                  </Tr>
                )
            )}

            {!isLoading && budgetList.length === 0 && !showAdd && (
              <tr><Td colSpan={6} className="text-center text-gray-400 py-8">
                No active budgets. Add one above to start enforcing AI inference spend.
              </Td></tr>
            )}
          </tbody>
        </Table>
      </Card>

      {dialog}
    </div>
  )
}
