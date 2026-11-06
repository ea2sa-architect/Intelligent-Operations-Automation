import { useState, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ChevronRight, ChevronUp, ChevronDown, Pencil, X, ShieldCheck, AlertTriangle, Download, Upload } from 'lucide-react'
import { governance, inference, workflowGovernance, platforms as platformsApi, mcp, downloadJson } from '../lib/api'
import { useAuth } from '../components/AuthGuard'
import { Card, CardHeader } from '../components/ui/Card'
import { Table, Th, Td, Tr } from '../components/ui/Table'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Input, Label, Select } from '../components/ui/Input'
import { InfoTip } from '../components/ui/InfoTip'
import { help } from '../lib/helpContent'
import { useConfirm } from '../hooks/useConfirm.jsx'
import { PolicyBundleImportModal } from './governance/PolicyBundleImportModal'

const statusVariant = { draft: 'default', active: 'success', inactive: 'warning', archived: 'danger' }
const STATUS_NEXT   = { draft: ['active'], active: ['inactive'], inactive: ['active', 'archived'], archived: [] }
const SEV_VARIANT   = { low: 'success', medium: 'warning', high: 'danger', critical: 'purple' }

// ── Auto-inferred policy helpers ───────────────────────────────────────────
const INFERRED_TYPE_LABEL = {
  guardrail:         'Operational Guardrails',
  mandatory_control: 'Mandatory Controls',
  ai_governance:     'AI Safety Controls',
}
const FRAMEWORK_VARIANT = { HIPAA: 'warning', GDPR: 'info', AI_GOVERNANCE: 'purple' }

// EP-201-S3
const ENFORCEMENT_MODES = ['observe', 'warn', 'enforce']
const ENFORCEMENT_LABEL = { observe: 'Observe', warn: 'Warn', enforce: 'Enforce' }
const ENFORCEMENT_ACTIVE_CLASS = {
  observe: 'bg-gray-700 text-white',
  warn:    'bg-yellow-500 text-white',
  enforce: 'bg-red-600 text-white',
}

const NAME_PREFIXES = [
  { prefix: 'ai-governance', label: 'AI Safety Controls' },
  { prefix: 'gdpr-pii',      label: 'GDPR PII Controls' },
  { prefix: 'hipaa',         label: 'Mandatory Controls' },
  { prefix: 'guardrails',    label: 'Operational Guardrails' },
]

function parseNamePrefix(name = '') {
  for (const { prefix, label } of NAME_PREFIXES) {
    const sep = name[prefix.length]
    if (name.startsWith(prefix) && (sep === '-' || sep === ':')) {
      return { label, workflowId: name.slice(prefix.length + 1) }
    }
  }
  return null
}

function isInferred(p) {
  return p.metadata_json?.source === 'workflow-governance-service'
}

function policyDisplayName(p, wfMap = {}) {
  const wfName = p.metadata_json?.workflow_name
  const label  = INFERRED_TYPE_LABEL[p.metadata_json?.policy_type]
  if (wfName && label) return `${label} · ${wfName}`

  const parsed = parseNamePrefix(p.name)
  if (parsed) {
    const resolved = wfMap[parsed.workflowId]
    return resolved ? `${parsed.label} · ${resolved}` : parsed.label
  }

  return p.name
}

// ── Shared helpers ─────────────────────────────────────────────────────────
function Field({ label, children }) {
  return <div><Label>{label}</Label>{children}</div>
}

const inputCls = 'text-sm border border-gray-300 rounded-md px-2 py-1.5 bg-white'

// ── ChipEditor — token list with add / remove ──────────────────────────────
function ChipEditor({ value = [], onChange, placeholder }) {
  const [draft, setDraft] = useState('')

  function add() {
    const t = draft.trim()
    if (!t || value.includes(t)) return
    onChange([...value, t])
    setDraft('')
  }

  return (
    <div>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {value.map(item => (
            <span key={item} className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">
              {item}
              <button type="button" onClick={() => onChange(value.filter(v => v !== item))}
                className="text-indigo-400 hover:text-indigo-700"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input type="text" value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); add() } }}
          placeholder={placeholder ?? 'Type and press Enter…'}
          className={`flex-1 ${inputCls}`}
        />
        <button type="button" onClick={add}
          className="px-2.5 py-1.5 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-md hover:bg-indigo-50">
          Add
        </button>
      </div>
    </div>
  )
}

// ── MultiEnumPills — pill-toggle for multi_enum fields ─────────────────────
function MultiEnumPills({ options = [], value = [], onChange }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(opt => {
        const on = value.includes(opt)
        return (
          <button key={opt} type="button"
            onClick={() => onChange(on ? value.filter(v => v !== opt) : [...value, opt])}
            className={`px-2.5 py-0.5 text-xs rounded-full border transition-colors ${
              on ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium'
                 : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
            }`}
          >{opt}</button>
        )
      })}
    </div>
  )
}

// ── TypedRuleForm — renders schema_json fields dynamically ─────────────────
function TypedRuleForm({ schema, values, onChange }) {
  if (!schema?.schema_json?.fields) return null

  return (
    <div className="space-y-3">
      {schema.schema_json.fields.map(field => (
        <div key={field.name}>
          <Label>{field.label}{field.required ? ' *' : ''}</Label>

          {field.type === 'string' && (
            <input type="text" value={values[field.name] ?? ''}
              onChange={e => onChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? ''}
              className={`w-full ${inputCls}`}
            />
          )}

          {field.type === 'description' && (
            <textarea rows={3} value={values[field.name] ?? ''}
              onChange={e => onChange(field.name, e.target.value)}
              placeholder={field.placeholder ?? ''}
              className={`w-full ${inputCls} resize-none`}
            />
          )}

          {(field.type === 'enum' || field.type === 'severity') && (
            <select value={values[field.name] ?? ''}
              onChange={e => onChange(field.name, e.target.value)}
              className={`w-full ${inputCls}`}
            >
              <option value="">— choose —</option>
              {field.options.map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          )}

          {field.type === 'multi_enum' && (
            <MultiEnumPills
              options={field.options ?? []}
              value={values[field.name] ?? []}
              onChange={v => onChange(field.name, v)}
            />
          )}

          {field.type === 'json_array' && (
            <ChipEditor
              value={values[field.name] ?? []}
              onChange={v => onChange(field.name, v)}
              placeholder={field.placeholder}
            />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Legacy rule builder constants ──────────────────────────────────────────
const ACTIONS = ['block', 'require_approval', 'alert', 'log', 'quarantine']

const CONDITION_FIELDS = {
  risk_score:      { label: 'Risk Score',          type: 'number',  ops: ['>', '>=', '<', '<=', '='] },
  risk_level:      { label: 'Risk Level',          type: 'enum',    ops: ['=', '!=', 'in'],           values: ['LOW','MEDIUM','HIGH','CRITICAL'] },
  platform:        { label: 'Platform',            type: 'enum',    ops: ['=', '!=', 'in'],           values: ['n8n','make','power_automate','zapier'] },
  pii_detected:    { label: 'PII Detected',        type: 'boolean', ops: ['='] },
  has_ai_nodes:    { label: 'Has AI Nodes',        type: 'boolean', ops: ['='] },
  node_count:      { label: 'Node Count',          type: 'number',  ops: ['>', '>=', '<', '<=', '='] },
  governance_type: { label: 'Contains Node Type',  type: 'enum',    ops: ['contains', 'not_contains'],
                     values: ['ai_inference','http','database','webhook','schedule','notification','storage','approval','credential','rpa','transform','logic'] },
  active:          { label: 'Active',              type: 'boolean', ops: ['='] },
}

function defaultValue(meta, op) {
  if (meta.type === 'boolean') return 'true'
  if (meta.type === 'enum' && op === 'in') return []
  return ''
}

function buildConditionJson(conditions, joinOp) {
  const built = conditions.map(c => {
    const meta = CONDITION_FIELDS[c.field]
    let value = c.value
    if (meta.type === 'number')  value = Number(c.value)
    if (meta.type === 'boolean') value = c.value === 'true'
    return { field: c.field, op: c.op, value }
  })
  if (built.length === 1) return built[0]
  return { operator: joinOp, conditions: built }
}

function validateRawJson(raw) {
  if (!raw.trim()) return null
  let parsed
  try { parsed = JSON.parse(raw) } catch (e) {
    return { ok: false, error: `Invalid JSON: ${e.message}` }
  }
  if (typeof parsed !== 'object' || Array.isArray(parsed) || parsed === null)
    return { ok: false, error: 'Must be a JSON object, not an array or primitive' }
  if (parsed.conditions !== undefined) {
    if (!['AND', 'OR'].includes(parsed.operator))
      return { ok: true, warn: 'operator should be "AND" or "OR"', parsed }
    if (!Array.isArray(parsed.conditions))
      return { ok: false, error: '"conditions" must be an array' }
    for (const c of parsed.conditions)
      if (!c.field || !c.op) return { ok: true, warn: 'Each condition should have "field" and "op"', parsed }
  } else {
    if (!parsed.field || !parsed.op)
      return { ok: true, warn: 'Expected "field" and "op" keys in single-condition object', parsed }
  }
  return { ok: true, parsed }
}

function restoreConditions(parsed) {
  if (parsed.conditions && Array.isArray(parsed.conditions)) {
    const conds = parsed.conditions.map(c => ({
      field: c.field in CONDITION_FIELDS ? c.field : 'risk_score',
      op:    c.op ?? '>',
      value: Array.isArray(c.value) ? c.value : String(c.value ?? ''),
    }))
    return { conditions: conds, joinOp: ['AND','OR'].includes(parsed.operator) ? parsed.operator : 'AND' }
  }
  if (parsed.field) {
    return {
      conditions: [{ field: parsed.field in CONDITION_FIELDS ? parsed.field : 'risk_score', op: parsed.op ?? '>', value: Array.isArray(parsed.value) ? parsed.value : String(parsed.value ?? '') }],
      joinOp: 'AND',
    }
  }
  return null
}

// ── Condition row (legacy) ─────────────────────────────────────────────────
function ConditionRow({ cond, onChange, onRemove, canRemove }) {
  const meta = CONDITION_FIELDS[cond.field] ?? CONDITION_FIELDS.risk_score
  const sel  = `${inputCls}`

  function handleFieldChange(newField) {
    const m = CONDITION_FIELDS[newField]
    onChange({ field: newField, op: m.ops[0], value: defaultValue(m, m.ops[0]) })
  }

  function handleOpChange(newOp) {
    const wasIn = cond.op === 'in'
    const isIn  = newOp === 'in'
    onChange({ ...cond, op: newOp, value: wasIn !== isIn ? (isIn ? [] : '') : cond.value })
  }

  return (
    <div className="flex items-start gap-2 flex-wrap">
      <select value={cond.field} onChange={e => handleFieldChange(e.target.value)} className={sel}>
        {Object.entries(CONDITION_FIELDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
      </select>
      <select value={cond.op} onChange={e => handleOpChange(e.target.value)} className={sel}>
        {meta.ops.map(op => <option key={op} value={op}>{op}</option>)}
      </select>

      {meta.type === 'boolean' && (
        <select value={cond.value} onChange={e => onChange({ ...cond, value: e.target.value })} className={sel}>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      )}
      {meta.type === 'number' && (
        <input type="number" value={cond.value} onChange={e => onChange({ ...cond, value: e.target.value })}
          placeholder="value" className="w-24 text-sm border border-gray-300 rounded-md px-2 py-1.5" />
      )}
      {meta.type === 'enum' && cond.op === 'in' && (
        <div className="flex flex-wrap gap-1 items-center pt-0.5">
          {meta.values.map(v => {
            const arr = Array.isArray(cond.value) ? cond.value : []
            const checked = arr.includes(v)
            return (
              <button key={v} type="button"
                onClick={() => onChange({ ...cond, value: checked ? arr.filter(x => x !== v) : [...arr, v] })}
                className={`px-2 py-0.5 text-xs rounded-full border transition-colors ${
                  checked ? 'bg-indigo-100 border-indigo-300 text-indigo-700 font-medium' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                }`}
              >{v}</button>
            )
          })}
        </div>
      )}
      {meta.type === 'enum' && cond.op !== 'in' && (
        <select value={cond.value} onChange={e => onChange({ ...cond, value: e.target.value })} className={sel}>
          <option value="">— choose —</option>
          {meta.values.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
      )}

      {canRemove && (
        <button type="button" onClick={onRemove} className="p-1 mt-0.5 text-gray-400 hover:text-red-500">
          <X size={14} />
        </button>
      )}
    </div>
  )
}

// ── Rule Builder ───────────────────────────────────────────────────────────
function RuleBuilder({ policyId, onDone, onCancel }) {
  const qc = useQueryClient()

  // Typed rule state
  const [ruleType,     setRuleType]     = useState('')
  const [configValues, setConfigValues] = useState({})

  // Legacy rule state
  const [action,      setAction]      = useState('')
  const [priority,    setPriority]    = useState(0)
  const [joinOp,      setJoinOp]      = useState('AND')
  const [conditions,  setConditions]  = useState([{ field: 'risk_score', op: '>', value: '' }])
  const [rawMode,     setRawMode]     = useState(false)
  const [rawJson,     setRawJson]     = useState('')
  const [rawState,    setRawState]    = useState(null)
  const [showPreview, setShowPreview] = useState(true)

  const { data: schemas = [] } = useQuery({
    queryKey: ['rule-schemas'],
    queryFn:  governance.listRuleSchemas,
    staleTime: Infinity,
  })

  const selectedSchema = schemas.find(s => s.type === ruleType) ?? null
  const isTyped = !!selectedSchema

  function handleTypeChange(type) {
    setRuleType(type)
    setConfigValues({})
  }

  function setConfigField(name, value) {
    setConfigValues(v => ({ ...v, [name]: value }))
  }

  const addRule = useMutation({
    mutationFn: body => governance.addRule(policyId, body),
    onSuccess:  ()   => { qc.invalidateQueries({ queryKey: ['policy', policyId] }); onDone() },
  })

  // Typed validation: all required fields must be filled
  const typedValid = useMemo(() => {
    if (!selectedSchema?.schema_json?.fields) return false
    return selectedSchema.schema_json.fields
      .filter(f => f.required)
      .every(f => {
        const v = configValues[f.name]
        return v !== undefined && v !== '' && !(Array.isArray(v) && v.length === 0)
      })
  }, [selectedSchema, configValues])

  // Legacy validation
  const conditionJson = useMemo(() => {
    if (conditions.some(c => c.value === '' || (Array.isArray(c.value) && c.value.length === 0))) return null
    try { return buildConditionJson(conditions, joinOp) } catch { return null }
  }, [conditions, joinOp])

  const wizardValid = conditions.length > 0 &&
    conditions.every(c => c.value !== '' && !(Array.isArray(c.value) && c.value.length === 0))
  const legacyCanSubmit = !!action && (rawMode ? rawState?.ok : wizardValid)

  const canSubmit = isTyped ? typedValid : legacyCanSubmit

  function toggleRaw() {
    if (!rawMode) {
      const json = conditionJson ?? buildConditionJson(conditions, joinOp)
      const s    = JSON.stringify(json, null, 2)
      setRawJson(s); setRawState(validateRawJson(s))
    } else {
      if (rawState?.ok && rawState.parsed) {
        const restored = restoreConditions(rawState.parsed)
        if (restored) { setConditions(restored.conditions); setJoinOp(restored.joinOp) }
      }
    }
    setRawMode(m => !m)
  }

  function submit(e) {
    e.preventDefault()
    if (isTyped) {
      const { severity, ...rest } = configValues
      addRule.mutate({
        rule_type:   ruleType,
        config_json: rest,
        severity:    severity || 'medium',
        enabled:     true,
      })
    } else {
      addRule.mutate({
        action,
        condition_json: rawMode ? rawState.parsed : buildConditionJson(conditions, joinOp),
        priority: Number(priority),
      })
    }
  }

  return (
    <form onSubmit={submit} className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg mb-3 space-y-4">

      {/* Rule Type selector */}
      <div>
        <Label>Rule Type *</Label>
        <select value={ruleType} onChange={e => handleTypeChange(e.target.value)}
          className={`w-full ${inputCls}`}
        >
          <option value="">— Custom Condition (legacy) —</option>
          {schemas.map(s => (
            <option key={s.type} value={s.type}>{s.display_name}</option>
          ))}
        </select>
        {selectedSchema && (
          <p className="text-xs text-gray-500 mt-1">{selectedSchema.description}</p>
        )}
      </div>

      {/* Typed rule form */}
      {isTyped && (
        <TypedRuleForm
          schema={selectedSchema}
          values={configValues}
          onChange={setConfigField}
        />
      )}

      {/* Legacy custom condition form */}
      {!isTyped && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Action *</Label>
              <select value={action} onChange={e => setAction(e.target.value)} required
                className={`w-full ${inputCls}`}
              >
                <option value="">— choose action —</option>
                {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <Label>Priority</Label>
              <input type="number" value={priority} onChange={e => setPriority(e.target.value)}
                className={`w-full ${inputCls}`} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Conditions *</Label>
              <button type="button" onClick={toggleRaw} className="text-xs text-indigo-600 hover:underline">
                {rawMode ? '← Back to builder' : 'Edit raw JSON →'}
              </button>
            </div>

            {rawMode ? (
              <div>
                <textarea rows={6} value={rawJson} onChange={e => { setRawJson(e.target.value); setRawState(validateRawJson(e.target.value)) }}
                  className={`w-full px-3 py-2 text-xs font-mono border rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    !rawState        ? 'border-gray-300'
                    : rawState.error ? 'border-red-400 bg-red-50'
                    : rawState.warn  ? 'border-yellow-400 bg-yellow-50'
                    :                  'border-green-400 bg-green-50/40'
                  }`}
                />
                {rawState?.error && <p className="text-xs text-red-600 mt-1">{rawState.error}</p>}
                {rawState?.warn && !rawState.error && <p className="text-xs text-yellow-700 mt-1">⚠ {rawState.warn}</p>}
                {rawState?.ok && !rawState.warn && <p className="text-xs text-green-700 mt-1">✓ Valid</p>}
              </div>
            ) : (
              <div className="space-y-2">
                {conditions.length > 1 && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-gray-500">Join with</span>
                    {['AND','OR'].map(op => (
                      <button key={op} type="button" onClick={() => setJoinOp(op)}
                        className={`px-2.5 py-0.5 text-xs rounded border font-medium transition-colors ${
                          joinOp === op ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                        }`}
                      >{op}</button>
                    ))}
                  </div>
                )}
                {conditions.map((cond, i) => (
                  <ConditionRow key={i} cond={cond}
                    onChange={updated => setConditions(c => c.map((r, idx) => idx === i ? updated : r))}
                    onRemove={() => setConditions(c => c.filter((_, idx) => idx !== i))}
                    canRemove={conditions.length > 1}
                  />
                ))}
                <button type="button"
                  onClick={() => setConditions(c => [...c, { field: 'risk_score', op: '>', value: '' }])}
                  className="text-xs text-indigo-600 hover:underline flex items-center gap-1 mt-1"
                >
                  <Plus size={11} /> Add condition
                </button>
              </div>
            )}
          </div>

          {!rawMode && conditionJson && (
            <div>
              <button type="button" onClick={() => setShowPreview(v => !v)}
                className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 select-none"
              >
                <span>{showPreview ? '▾' : '▸'}</span> JSON preview
              </button>
              {showPreview && (
                <pre className="mt-1.5 p-3 text-xs text-gray-600 bg-white border border-gray-200 rounded-md overflow-auto leading-relaxed">
                  {JSON.stringify(conditionJson, null, 2)}
                </pre>
              )}
            </div>
          )}
        </>
      )}

      {addRule.error && <p className="text-xs text-red-600">{addRule.error.message}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSubmit || addRule.isPending}>
          {addRule.isPending ? 'Adding…' : 'Add Rule'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </form>
  )
}

// ── Rule card — handles typed and legacy rules ─────────────────────────────
function RuleCard({ rule, onDelete }) {
  const [expanded, setExpanded] = useState(false)

  if (rule.rule_type) {
    const cfg = rule.config_json ?? {}
    const cfgEntries = Object.entries(cfg).filter(([, v]) =>
      v !== null && v !== '' && !(Array.isArray(v) && v.length === 0)
    )
    return (
      <div className="p-3 bg-gray-50 rounded mb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap mb-1.5">
              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-100 text-violet-700 rounded text-xs font-semibold">
                <ShieldCheck size={11} />{rule.rule_type.replace(/_/g, ' ')}
              </span>
              <Badge variant={SEV_VARIANT[rule.severity] ?? 'default'}>{rule.severity}</Badge>
              {!rule.enabled && (
                <span className="px-1.5 py-0.5 text-xs bg-gray-200 text-gray-500 rounded">disabled</span>
              )}
            </div>
            {cfgEntries.length > 0 && (
              <div className="space-y-0.5">
                {cfgEntries.slice(0, expanded ? undefined : 3).map(([k, v]) => (
                  <p key={k} className="text-xs text-gray-600">
                    <span className="text-gray-400 font-medium">{k.replace(/_/g, ' ')}:</span>{' '}
                    {Array.isArray(v) ? v.join(', ') : String(v)}
                  </p>
                ))}
                {cfgEntries.length > 3 && (
                  <button type="button" onClick={() => setExpanded(e => !e)}
                    className="text-xs text-indigo-500 hover:underline mt-0.5">
                    {expanded ? 'show less' : `+${cfgEntries.length - 3} more`}
                  </button>
                )}
              </div>
            )}
          </div>
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 shrink-0">
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    )
  }

  // Legacy rule
  return (
    <div className="flex items-start justify-between p-3 bg-gray-50 rounded mb-2 gap-2">
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-700">
          <span className="inline-block px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-xs font-semibold mr-1.5">{rule.action}</span>
          <span className="text-gray-400 font-normal">priority {rule.priority}</span>
        </p>
        <pre className="text-xs text-gray-500 mt-1.5 whitespace-pre-wrap leading-relaxed overflow-auto">
          {JSON.stringify(rule.condition_json, null, 2)}
        </pre>
      </div>
      <button onClick={onDelete} className="text-gray-400 hover:text-red-500 shrink-0">
        <Trash2 size={14} />
      </button>
    </div>
  )
}

// ── Binding builder ────────────────────────────────────────────────────────
const ENTITY_TYPES = [
  { value: 'workflow',  label: 'Workflow' },
  { value: 'model',     label: 'AI Model' },
  { value: 'platform',  label: 'Platform Connection' },
  { value: 'project',   label: 'Project' },
  { value: 'service',   label: 'Service' },
  { value: 'mcp_server', label: 'MCP Server' },
  { value: 'mcp_tool',   label: 'MCP Tool' },
]

const PLATFORM_SERVICES = [
  'governance-service', 'ai-inference-service', 'audit-service',
  'escalation-service', 'telemetry-service', 'workflow-governance-service',
]

function BindingBuilder({ policyId, onDone, onCancel }) {
  const qc = useQueryClient()
  const [entityType, setEntityType] = useState('')
  const [entityId,   setEntityId]   = useState('')
  const [search,     setSearch]     = useState('')

  const { data: workflows = [], isLoading: wfLoading } = useQuery({
    queryKey: ['wf-list-binding'],
    queryFn:  () => workflowGovernance.listWorkflows({ limit: 200 }),
    enabled:  entityType === 'workflow',
    staleTime: 60_000,
  })
  const { data: models = [], isLoading: modelLoading } = useQuery({
    queryKey: ['models-binding'],
    queryFn:  () => inference.listModels(),
    enabled:  entityType === 'model',
    staleTime: 60_000,
  })
  const { data: connections = [], isLoading: connLoading } = useQuery({
    queryKey: ['platforms-binding'],
    queryFn:  platformsApi.list,
    enabled:  entityType === 'platform',
    staleTime: 60_000,
  })
  const { data: projects = [], isLoading: projLoading } = useQuery({
    queryKey: ['projects-binding'],
    queryFn:  workflowGovernance.n8nProjects,
    enabled:  entityType === 'project',
    staleTime: 60_000,
  })
  const { data: mcpServers = [], isLoading: mcpServersLoading } = useQuery({
    queryKey: ['mcp-servers-binding'],
    queryFn:  () => mcp.listServers(),
    enabled:  entityType === 'mcp_server' || entityType === 'mcp_tool',
    staleTime: 60_000,
  })
  const [toolServerId, setToolServerId] = useState('')
  const { data: toolServerDetail, isLoading: toolServerLoading } = useQuery({
    queryKey: ['mcp-server-tools-binding', toolServerId],
    queryFn:  () => mcp.getServer(toolServerId),
    enabled:  entityType === 'mcp_tool' && !!toolServerId,
  })

  const addBinding = useMutation({
    mutationFn: () => governance.addBinding(policyId, { entity_type: entityType, entity_id: entityId }),
    onSuccess:  ()  => { qc.invalidateQueries({ queryKey: ['policy', policyId] }); onDone() },
  })

  function handleTypeChange(type) { setEntityType(type); setEntityId(''); setSearch(''); setToolServerId('') }

  const filteredWorkflows = search
    ? workflows.filter(w => w.name.toLowerCase().includes(search.toLowerCase()))
    : workflows

  const canSubmit = entityType && entityId

  return (
    <form onSubmit={e => { e.preventDefault(); addBinding.mutate() }}
      className="p-4 bg-indigo-50 border border-indigo-100 rounded-lg mb-3 space-y-3"
    >
      <div>
        <Label>Entity Type *</Label>
        <select value={entityType} onChange={e => handleTypeChange(e.target.value)} required
          className={`w-full ${inputCls}`}
        >
          <option value="">— choose type —</option>
          {ENTITY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      {entityType === 'workflow' && (
        <div>
          <Label>Workflow</Label>
          <input type="text" placeholder="Search workflows…" value={search}
            onChange={e => setSearch(e.target.value)} className={`w-full ${inputCls} mb-1`} />
          <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-md bg-white">
            {wfLoading
              ? <p className="text-xs text-gray-400 p-3">Loading…</p>
              : filteredWorkflows.length === 0
              ? <p className="text-xs text-gray-400 p-3">No workflows found</p>
              : filteredWorkflows.map(w => (
                <button type="button" key={w.id} onClick={() => setEntityId(w.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between ${entityId === w.id ? 'bg-indigo-50' : ''}`}
                >
                  <span className="truncate">{w.name}</span>
                  {entityId === w.id && <span className="text-indigo-500 ml-2 shrink-0 text-xs font-bold">✓</span>}
                </button>
              ))
            }
          </div>
          {entityId && <p className="text-xs text-gray-400 mt-1 font-mono truncate">id: {entityId}</p>}
        </div>
      )}

      {entityType === 'model' && (
        <div>
          <Label>AI Model</Label>
          <select value={entityId} onChange={e => setEntityId(e.target.value)} required
            className={`w-full ${inputCls}`}
          >
            <option value="">— choose model —</option>
            {modelLoading ? <option disabled>Loading…</option>
              : models.map(m => <option key={m.id} value={m.id}>{m.name ?? m.model_id}</option>)}
          </select>
        </div>
      )}

      {entityType === 'platform' && (
        <div>
          <Label>Platform Connection</Label>
          <select value={entityId} onChange={e => setEntityId(e.target.value)} required
            className={`w-full ${inputCls}`}
          >
            <option value="">— choose connection —</option>
            {connLoading ? <option disabled>Loading…</option>
              : connections.map(c => <option key={c.id} value={c.id}>{c.name} ({c.platform})</option>)}
          </select>
        </div>
      )}

      {entityType === 'project' && (
        <div>
          <Label>n8n Project</Label>
          <select value={entityId} onChange={e => setEntityId(e.target.value)} required
            className={`w-full ${inputCls}`}
          >
            <option value="">— choose project —</option>
            {projLoading ? <option disabled>Loading…</option>
              : projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      )}

      {entityType === 'service' && (
        <div>
          <Label>Service</Label>
          <input list="svc-datalist" value={entityId} onChange={e => setEntityId(e.target.value)}
            placeholder="Service name…" className={`w-full ${inputCls}`} required />
          <datalist id="svc-datalist">
            {PLATFORM_SERVICES.map(s => <option key={s} value={s} />)}
          </datalist>
        </div>
      )}

      {entityType === 'mcp_server' && (
        <div>
          <Label>MCP Server</Label>
          <select value={entityId} onChange={e => setEntityId(e.target.value)} required
            className={`w-full ${inputCls}`}
          >
            <option value="">— choose MCP server —</option>
            {mcpServersLoading ? <option disabled>Loading…</option>
              : mcpServers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
          </select>
        </div>
      )}

      {entityType === 'mcp_tool' && (
        <div className="space-y-2">
          <div>
            <Label>MCP Server</Label>
            <select value={toolServerId} onChange={e => { setToolServerId(e.target.value); setEntityId('') }} required
              className={`w-full ${inputCls}`}
            >
              <option value="">— choose MCP server —</option>
              {mcpServersLoading ? <option disabled>Loading…</option>
                : mcpServers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          {toolServerId && (
            <div>
              <Label>Tool</Label>
              <select value={entityId} onChange={e => setEntityId(e.target.value)} required
                className={`w-full ${inputCls}`}
              >
                <option value="">— choose tool —</option>
                {toolServerLoading ? <option disabled>Loading…</option>
                  : (toolServerDetail?.tools ?? []).map(t => <option key={t.id} value={t.id}>{t.name} ({t.classification ?? 'unclassified'})</option>)}
              </select>
            </div>
          )}
        </div>
      )}

      {addBinding.error && <p className="text-xs text-red-600">{addBinding.error.message}</p>}

      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={!canSubmit || addBinding.isPending}>
          {addBinding.isPending ? 'Adding…' : 'Add Binding'}
        </Button>
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">Cancel</button>
      </div>
    </form>
  )
}

// ── Create Policy ──────────────────────────────────────────────────────────
function CreatePolicyModal({ onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: '', description: '', status: 'draft' })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const create = useMutation({
    mutationFn: governance.createPolicy,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['policies'] }); onClose() },
  })

  return (
    <Modal title="New Policy" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); create.mutate(form) }} className="space-y-4">
        <Field label="Name *"><Input value={form.name} onChange={set('name')} required /></Field>
        <Field label="Description"><Input value={form.description} onChange={set('description')} /></Field>
        <Field label="Status">
          <Select value={form.status} onChange={set('status')}>
            {['draft','active','inactive','archived'].map(s => <option key={s}>{s}</option>)}
          </Select>
        </Field>
        {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
        <Button type="submit" disabled={create.isPending} className="w-full justify-center">
          {create.isPending ? 'Creating…' : 'Create Policy'}
        </Button>
      </form>
    </Modal>
  )
}

// ── Edit Policy ────────────────────────────────────────────────────────────
function EditPolicyModal({ policy, onClose }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: policy.name, description: policy.description ?? '' })
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  const update = useMutation({
    mutationFn: body => governance.updatePolicy(policy.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      qc.invalidateQueries({ queryKey: ['policy', policy.id] })
      onClose()
    },
  })

  return (
    <Modal title="Edit Policy" onClose={onClose}>
      <form onSubmit={e => { e.preventDefault(); update.mutate(form) }} className="space-y-4">
        <Field label="Name *"><Input value={form.name} onChange={set('name')} required /></Field>
        <Field label="Description"><Input value={form.description} onChange={set('description')} /></Field>
        {update.error && <p className="text-sm text-red-600">{update.error.message}</p>}
        <Button type="submit" disabled={update.isPending} className="w-full justify-center">
          {update.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
      </form>
    </Modal>
  )
}

// ── Policy Detail (rules + bindings + violations) ──────────────────────────
// Policy bundle export. A bundle cannot represent legacy condition_json rules,
// so the server refuses by default rather than silently dropping them; offer
// the user the explicit choice instead of failing the download.
async function exportBundleFile(opts, confirm) {
  let bundle
  try {
    bundle = await governance.exportBundle(opts)
  } catch (e) {
    if (!/legacy/i.test(e.message)) throw e
    const ok = await confirm({
      title: 'Export without legacy rules?',
      message: `${e.message} The exported bundle would leave those rules out, so importing it would give a weaker policy.`,
      confirmLabel: 'Export without them',
    })
    if (!ok) return
    bundle = await governance.exportBundle({ ...opts, skipLegacy: true })
  }
  downloadJson(bundle, `ioa-policy-bundle-${bundle.exported_at.slice(0, 10)}.json`)
}

// Rule types the platform records but does not evaluate (derived server-side
// from the policy's current rules): shown wherever someone might assume an
// Active/Enforce policy is protecting them.
function UnevaluatedBadge() {
  return (
    <span
      title={help.governance.unevaluatedRules}
      className="inline-flex items-center gap-1 px-1.5 py-0 text-xs bg-amber-100 text-amber-800 rounded font-medium"
    >
      <AlertTriangle size={10} />unevaluated rules
    </span>
  )
}

function PolicyDetail({ policy: init, onClose, wfMap = {} }) {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [showEditPolicy, setShowEditPolicy] = useState(false)
  const [showAddRule,    setShowAddRule]    = useState(false)
  const [showAddBinding, setShowAddBinding] = useState(false)
  const [exportError,    setExportError]    = useState(null)

  const { data: p = init } = useQuery({
    queryKey: ['policy', init.id],
    queryFn:  () => governance.getPolicy(init.id),
  })

  const setStatus = useMutation({
    mutationFn: ({ id, status }) => governance.setStatus(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      qc.invalidateQueries({ queryKey: ['policy', init.id] })
    },
  })

  const setEnforcementMode = useMutation({
    mutationFn: ({ id, mode }) => governance.setEnforcementMode(id, mode),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      qc.invalidateQueries({ queryKey: ['policy', init.id] })
    },
  })

  const deleteRule = useMutation({
    mutationFn: ruleId => governance.deleteRule(p.id, ruleId),
    onSuccess:  ()     => qc.invalidateQueries({ queryKey: ['policy', init.id] }),
  })

  const deleteBinding = useMutation({
    mutationFn: bindingId => governance.deleteBinding(p.id, bindingId),
    onSuccess:  ()        => qc.invalidateQueries({ queryKey: ['policy', init.id] }),
  })

  const v = p.violations ?? {}
  const openCount = Number(v.open ?? 0)
  const unevaluated = p.unevaluated_rule_types ?? []

  // Activating or enforcing a policy that holds rules nothing evaluates would
  // let someone believe it protects them when those rules are no-ops.
  async function confirmUnevaluated(confirmLabel) {
    if (!unevaluated.length) return true
    return confirm({
      title: 'This policy has unevaluated rules',
      message: `The platform does not evaluate these rule types yet: ${unevaluated.join(', ')}. They are recorded but never checked, so this policy will not protect against what they describe, even when active or enforcing.`,
      confirmLabel,
    })
  }

  async function exportOne() {
    setExportError(null)
    try { await exportBundleFile({ ids: [p.id] }, confirm) } catch (e) { setExportError(e.message) }
  }

  return (
    <>
      <Modal title={policyDisplayName(p, wfMap)} onClose={onClose}>
        <div className="space-y-6">

          {/* Status + actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={statusVariant[p.status]}>{p.status}</Badge>
            <InfoTip content={help.governance.policyStatus} side="bottom" size={12} />
            <span className="text-xs text-gray-400">v{p.version}</span>
            <InfoTip content={help.governance.colVersion} side="bottom" size={12} />
            {unevaluated.length > 0 && <UnevaluatedBadge />}
            {isInferred(p) && (
              <span className="px-1.5 py-0 text-xs bg-indigo-100 text-indigo-700 rounded font-medium">AUTO</span>
            )}
            {p.metadata_json?.compliance_framework && (
              <Badge variant={FRAMEWORK_VARIANT[p.metadata_json.compliance_framework] ?? 'default'}>
                {p.metadata_json.compliance_framework}
              </Badge>
            )}
            <button onClick={exportOne} title="Export as policy bundle" className="text-gray-400 hover:text-indigo-600 ml-auto">
              <Download size={14} />
            </button>
            <button onClick={() => setShowEditPolicy(true)} className="text-gray-400 hover:text-indigo-600">
              <Pencil size={14} />
            </button>
            {STATUS_NEXT[p.status]?.map(s => (
              <Button key={s} size="sm" variant="secondary" onClick={async () => {
                if (s === 'active' && !(await confirmUnevaluated('Activate anyway'))) return
                setStatus.mutate({ id: p.id, status: s })
              }}>
                → {s}
              </Button>
            ))}
          </div>

          {/* EP-201-S3 — enforcement mode is a separate lever from lifecycle
              status above: a policy stays 'active' the whole time, only its
              enforcement_mode changes as an operator gains confidence. */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-500">Enforcement:</span>
            <div className="inline-flex rounded-md border border-gray-200 overflow-hidden">
              {ENFORCEMENT_MODES.map(mode => (
                <button
                  key={mode}
                  disabled={setEnforcementMode.isPending}
                  onClick={async () => {
                    if (mode !== 'observe' && mode !== p.enforcement_mode && !(await confirmUnevaluated(`Switch to ${ENFORCEMENT_LABEL[mode]}`))) return
                    setEnforcementMode.mutate({ id: p.id, mode })
                  }}
                  className={`px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                    p.enforcement_mode === mode
                      ? ENFORCEMENT_ACTIVE_CLASS[mode]
                      : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  {ENFORCEMENT_LABEL[mode]}
                </button>
              ))}
            </div>
            <InfoTip content={help.governance.enforcementMode} side="bottom" size={12} />
          </div>

          {exportError && <p className="text-sm text-red-600">{exportError}</p>}

          {p.description && <p className="text-sm text-gray-600">{p.description}</p>}

          {isInferred(p) && (() => {
            const wfName    = p.metadata_json?.workflow_name ?? wfMap[parseNamePrefix(p.name)?.workflowId]
            const riskScore = p.metadata_json?.inferred_from?.risk_score
            return wfName ? (
              <p className="text-xs text-gray-500">
                Workflow: <span className="font-medium text-gray-700">{wfName}</span>
                {riskScore != null && <span className="ml-2 text-gray-400">· risk score {riskScore}</span>}
              </p>
            ) : null
          })()}

          {/* Violations summary */}
          {Number(v.total ?? 0) > 0 && (
            <div className={`flex items-center gap-3 px-3 py-2 rounded-lg text-xs ${
              openCount > 0 ? 'bg-red-50 border border-red-100' : 'bg-gray-50 border border-gray-100'
            }`}>
              <AlertTriangle size={13} className={openCount > 0 ? 'text-red-500' : 'text-gray-400'} />
              <span className="font-medium text-gray-700">Violations:</span>
              {openCount > 0 && <span className="text-red-600 font-semibold">{openCount} open</span>}
              {Number(v.acknowledged ?? 0) > 0 && <span className="text-yellow-600">{v.acknowledged} acknowledged</span>}
              {Number(v.resolved ?? 0) > 0 && <span className="text-green-600">{v.resolved} resolved</span>}
            </div>
          )}

          {/* Rules */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                Rules ({p.rules?.length ?? 0})
                <InfoTip content={help.governance.rules} side="right" size={11} />
              </h3>
              <button onClick={() => setShowAddRule(v => !v)}
                className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
              >
                <Plus size={12} />{showAddRule ? 'Cancel' : 'Add Rule'}
                {!showAddRule && <InfoTip content={help.governance.addRule} side="left" size={11} />}
              </button>
            </div>

            {showAddRule && (
              <RuleBuilder
                policyId={p.id}
                onDone={()   => setShowAddRule(false)}
                onCancel={() => setShowAddRule(false)}
              />
            )}

            {p.rules?.length === 0 && !showAddRule && <p className="text-sm text-gray-400">No rules</p>}
            {p.rules?.map(r => (
              <RuleCard key={r.id} rule={r} onDelete={async () => {
                const ok = await confirm({
                  title: 'Delete Rule',
                  message: `Remove this ${r.rule_type ? `"${r.rule_type.replace(/_/g, ' ')}"` : `"${r.action}"`} rule? This cannot be undone.`,
                  confirmLabel: 'Delete Rule',
                })
                if (ok) deleteRule.mutate(r.id)
              }} />
            ))}
          </div>

          {/* Bindings */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 uppercase flex items-center">
                Bindings ({p.bindings?.length ?? 0})
                <InfoTip content={help.governance.bindings} side="right" size={11} />
              </h3>
              <button onClick={() => setShowAddBinding(v => !v)}
                className="text-xs text-indigo-600 hover:underline flex items-center gap-1"
              >
                <Plus size={12} />{showAddBinding ? 'Cancel' : 'Add Binding'}
                {!showAddBinding && <InfoTip content={help.governance.addBinding} side="left" size={11} />}
              </button>
            </div>

            {showAddBinding && (
              <BindingBuilder
                policyId={p.id}
                onDone={()   => setShowAddBinding(false)}
                onCancel={() => setShowAddBinding(false)}
              />
            )}

            {p.bindings?.length === 0 && !showAddBinding && <p className="text-sm text-gray-400">No bindings</p>}
            {p.bindings?.map(b => (
              <div key={b.id} className="flex items-center justify-between py-1.5 border-b border-gray-100 last:border-0">
                <span className="text-xs text-gray-600">{b.entity_type} / {b.entity_id}</span>
                <button
                  onClick={async () => {
                    const ok = await confirm({ title: 'Remove Binding', message: `Remove binding for ${b.entity_type} / ${b.entity_id}?`, confirmLabel: 'Remove' })
                    if (ok) deleteBinding.mutate(b.id)
                  }}
                  className="text-gray-400 hover:text-red-500"
                ><Trash2 size={13} /></button>
              </div>
            ))}
          </div>

        </div>
      </Modal>

      {showEditPolicy && <EditPolicyModal policy={p} onClose={() => setShowEditPolicy(false)} />}
      {dialog}
    </>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────
export function Governance() {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const { hasPermission } = useAuth()
  const canEditPolicy = hasPermission('policy:edit')
  const canImport     = hasPermission('policy:import')
  const fileRef = useRef(null)
  const [importing,     setImporting]   = useState(null)   // { bundle, fileName } while the preview is open
  const [bundleMsg,     setBundleMsg]   = useState(null)   // { tone: 'error' | 'success', text }
  const [showCreate,    setShowCreate]   = useState(false)
  const [selected,      setSelected]    = useState(null)
  const [editing,       setEditing]     = useState(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const [statusFilter,  setStatusFilter] = useState(searchParams.get('status') ?? '')
  const [sortCol,       setSortCol]     = useState('created_at')
  const [sortDir,       setSortDir]     = useState('desc')

  function handleStatusFilter(value) {
    setStatusFilter(value)
    if (value) setSearchParams({ status: value }, { replace: true })
    else setSearchParams({}, { replace: true })
  }

  async function handleBundleFile(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // let the same file be picked again
    if (!file) return
    try {
      setImporting({ bundle: JSON.parse(await file.text()), fileName: file.name })
      setBundleMsg(null)
    } catch {
      setBundleMsg({ tone: 'error', text: `${file.name} is not valid JSON.` })
    }
  }

  async function handleExportAll() {
    setBundleMsg(null)
    try { await exportBundleFile({ status: statusFilter || undefined }, confirm) }
    catch (e) { setBundleMsg({ tone: 'error', text: e.message }) }
  }

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ['policies', statusFilter],
    queryFn:  () => governance.listPolicies(statusFilter || undefined),
  })

  const { data: wfList = [] } = useQuery({
    queryKey: ['workflows-lookup'],
    queryFn:  () => workflowGovernance.listWorkflows({ limit: 200 }),
    staleTime: 5 * 60 * 1000,
  })
  const wfMap = useMemo(
    () => Object.fromEntries(wfList.map(w => [w.id, w.name])),
    [wfList]
  )

  const sortedPolicies = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...policies].sort((a, b) => {
      if (sortCol === 'name')             return dir * policyDisplayName(a, wfMap).localeCompare(policyDisplayName(b, wfMap))
      if (sortCol === 'status')           return dir * a.status.localeCompare(b.status)
      if (sortCol === 'version')          return dir * (a.version - b.version)
      if (sortCol === 'open_violations')  return dir * (Number(a.open_violations ?? 0) - Number(b.open_violations ?? 0))
      if (sortCol === 'created_at')       return dir * (new Date(a.created_at) - new Date(b.created_at))
      return 0
    })
  }, [policies, sortCol, sortDir, wfMap])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const remove = useMutation({
    mutationFn: governance.deletePolicy,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['policies'] }),
  })

  const COLS = [
    { col: 'name',            label: 'Name',       tip: help.governance.colName },
    { col: 'status',          label: 'Status',     tip: help.governance.colStatus },
    { col: 'version',         label: 'Version',    tip: help.governance.colVersion },
    { col: 'open_violations', label: 'Violations', tip: 'Open policy violations detected against bound workflows' },
    { col: 'created_at',      label: 'Created',    tip: help.governance.colCreated },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center">
            Governance
            <InfoTip content={help.governance.pageTitle} side="right" size={15} />
          </h1>
          <p className="text-sm text-gray-500 mt-1 flex items-center">
            Policy definitions and entity bindings
            <InfoTip content={help.governance.subtitle} side="bottom" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={handleExportAll}><Download size={16} />Export</Button>
          <InfoTip content={help.governance.exportBundle} side="bottom" />
          {canImport && (
            <>
              <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" data-testid="bundle-file" onChange={handleBundleFile} />
              <Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={16} />Import</Button>
              <InfoTip content={help.governance.importBundle} side="bottom" />
            </>
          )}
          {canEditPolicy && <Button onClick={() => setShowCreate(true)}><Plus size={16} />New Policy</Button>}
          <InfoTip content={help.governance.createPolicy} side="bottom" />
        </div>
      </div>

      {bundleMsg && (
        <p className={`text-sm ${bundleMsg.tone === 'error' ? 'text-red-600' : 'text-green-700'}`}>{bundleMsg.text}</p>
      )}

      <Card>
        <CardHeader className="flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Filter:</span>
          <Select value={statusFilter} onChange={e => handleStatusFilter(e.target.value)} className="w-40">
            <option value="">All statuses</option>
            {['draft','active','inactive','archived'].map(s => <option key={s}>{s}</option>)}
          </Select>
          <InfoTip content={help.governance.statusFilter} side="bottom" />
        </CardHeader>
        <Table>
          <thead><tr>
            {COLS.map(({ col, label, tip }) => (
              <Th key={col}>
                <button onClick={() => toggleSort(col)}
                  className="flex items-center gap-1 hover:text-gray-900 transition-colors select-none"
                >
                  {label}
                  <span className="flex flex-col -space-y-1">
                    <ChevronUp  size={10} className={sortCol === col && sortDir === 'asc'  ? 'text-indigo-600' : 'text-gray-300'} />
                    <ChevronDown size={10} className={sortCol === col && sortDir === 'desc' ? 'text-indigo-600' : 'text-gray-300'} />
                  </span>
                  <InfoTip content={tip} side="bottom" />
                </button>
              </Th>
            ))}
            <Th />
          </tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}
            {sortedPolicies.map(p => {
              const openV = Number(p.open_violations ?? 0)
              return (
                <Tr key={p.id} onClick={() => setSelected(p)}>
                  <Td className="font-medium text-gray-900 max-w-xs">
                    <div className="flex items-start gap-2">
                      <span className="truncate">{policyDisplayName(p, wfMap)}</span>
                      <div className="flex items-center gap-1 shrink-0">
                        {p.unevaluated_rule_types?.length > 0 && <UnevaluatedBadge />}
                        {isInferred(p) && (
                          <span className="px-1.5 py-0 text-xs bg-indigo-100 text-indigo-700 rounded font-medium">AUTO</span>
                        )}
                        {p.metadata_json?.compliance_framework && (
                          <Badge variant={FRAMEWORK_VARIANT[p.metadata_json.compliance_framework] ?? 'default'}>
                            {p.metadata_json.compliance_framework}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td><Badge variant={statusVariant[p.status]}>{p.status}</Badge></Td>
                  <Td>v{p.version}</Td>
                  <Td>
                    {openV > 0
                      ? <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 rounded-full">
                          <AlertTriangle size={10} />{openV}
                        </span>
                      : <span className="text-xs text-gray-300">—</span>
                    }
                  </Td>
                  <Td>{new Date(p.created_at).toLocaleDateString()}</Td>
                  <Td>
                    <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                      {canEditPolicy && <button onClick={() => setEditing(p)} className="text-gray-400 hover:text-indigo-600"><Pencil size={15} /></button>}
                      <button onClick={() => setSelected(p)} className="text-gray-400 hover:text-indigo-600"><ChevronRight size={16} /></button>
                      {canEditPolicy && (
                        <button
                          onClick={async () => {
                            const ok = await confirm({ title: 'Delete Policy', message: `Permanently delete "${policyDisplayName(p, wfMap)}"? All rules and bindings will be removed.`, confirmLabel: 'Delete Policy' })
                            if (ok) remove.mutate(p.id)
                          }}
                          className="text-gray-400 hover:text-red-500"
                        ><Trash2 size={15} /></button>
                      )}
                    </div>
                  </Td>
                </Tr>
              )
            })}
            {!isLoading && policies.length === 0 && (
              <tr><Td colSpan={6} className="text-center text-gray-400">No policies found</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>

      {showCreate && <CreatePolicyModal onClose={() => setShowCreate(false)} />}
      {editing    && <EditPolicyModal policy={editing} onClose={() => setEditing(null)} />}
      {selected   && <PolicyDetail policy={selected} onClose={() => setSelected(null)} wfMap={wfMap} />}
      {importing  && (
        <PolicyBundleImportModal
          bundle={importing.bundle}
          fileName={importing.fileName}
          onClose={() => setImporting(null)}
          onImported={res => {
            setImporting(null)
            const n = res.imported.length
            setBundleMsg({ tone: 'success', text: `Imported ${n} ${n === 1 ? 'policy' : 'policies'} as Draft / Observe. Review and activate them when ready.` })
          }}
        />
      )}
      {dialog}
    </div>
  )
}
