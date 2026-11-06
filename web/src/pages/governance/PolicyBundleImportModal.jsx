import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, XCircle, Info } from 'lucide-react'
import { governance } from '../../lib/api'
import { useAuth } from '../../components/AuthGuard'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Table, Th, Td, Tr } from '../../components/ui/Table'
import { InfoTip } from '../../components/ui/InfoTip'
import { help } from '../../lib/helpContent'
import { useConfirm } from '../../hooks/useConfirm.jsx'

const ACTION_VARIANT = { create: 'success', replace: 'warning', conflict: 'danger' }
const ACTION_LABEL   = { create: 'Create', replace: 'Replace', conflict: 'Name exists' }

function Issues({ items, tone }) {
  if (!items?.length) return null
  const isError = tone === 'error'
  const Icon = isError ? XCircle : AlertTriangle
  return (
    <ul className={`space-y-1 rounded-md border p-3 text-sm ${isError ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2">
          <Icon size={14} className="mt-0.5 shrink-0" />
          <span><code className="text-xs opacity-80">{it.path}</code> {it.message}</span>
        </li>
      ))}
    </ul>
  )
}

// Preview + confirm step for a policy bundle file already parsed by the page.
// Validation is a dry run on the server; nothing is written until Import is
// pressed, and the server re-validates at that point.
export function PolicyBundleImportModal({ bundle, fileName, onClose, onImported }) {
  const qc = useQueryClient()
  const { hasPermission } = useAuth()
  const { confirm, dialog } = useConfirm()
  const canReplace = hasPermission('policy:edit')
  const [onConflict, setOnConflict] = useState('reject')

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['policy-bundle-validate', fileName, onConflict],
    queryFn:  () => governance.validateBundle(bundle, onConflict),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  })

  const doImport = useMutation({
    mutationFn: () => governance.importBundle(bundle, onConflict),
    onSuccess: res => {
      qc.invalidateQueries({ queryKey: ['policies'] })
      onImported(res)
    },
    onError: () => refetch(), // show what changed since the preview
  })

  const plan = data?.plan ?? []
  const hasExisting = plan.some(p => p.action === 'conflict' || p.action === 'replace')
  const replacing = plan.filter(p => p.action === 'replace')

  async function submit() {
    if (replacing.length) {
      const ok = await confirm({
        title: 'Replace existing policies?',
        message: `${replacing.map(p => `"${p.name}" (currently ${p.existing.status} / ${p.existing.enforcement_mode})`).join(', ')} will have their rules and bindings replaced and be reset to Draft / Observe, so they stop being enforced until you activate them again.`,
        confirmLabel: 'Replace',
      })
      if (!ok) return
    }
    doImport.mutate()
  }

  return (
    <>
      <Modal title="Import Policy Bundle" onClose={onClose} size="lg">
        <div className="space-y-4">
          <p className="text-sm text-gray-500 flex items-center">
            {fileName}
            <InfoTip content={help.governance.importBundle} side="bottom" />
          </p>

          <div className="flex items-start gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
            <Info size={14} className="mt-0.5 shrink-0" />
            <span>Imported policies are created as <strong>Draft</strong> with enforcement set to <strong>Observe</strong>, whatever mode the file requests. Nothing is active until you activate it.</span>
          </div>

          {isLoading && <p className="text-sm text-gray-400">Validating…</p>}
          {error && <p className="text-sm text-red-600">{error.message}</p>}

          {data && (
            <>
              <Table>
                <thead><tr><Th>Policy</Th><Th>Action</Th><Th>Rules</Th><Th>Bindings</Th><Th>File asks for</Th></tr></thead>
                <tbody>
                  {plan.map(p => (
                    <Tr key={p.name}>
                      <Td className="font-medium text-gray-900">{p.name}</Td>
                      <Td><Badge variant={ACTION_VARIANT[p.action]}>{ACTION_LABEL[p.action]}</Badge></Td>
                      <Td>{p.rules}</Td>
                      <Td>{p.bindings}</Td>
                      <Td className="capitalize">{p.requested_mode} <span className="text-xs text-gray-400">→ observe</span></Td>
                    </Tr>
                  ))}
                  {plan.length === 0 && <tr><Td colSpan={5} className="text-center text-gray-400">Nothing to import</Td></tr>}
                </tbody>
              </Table>

              <Issues items={data.errors} tone="error" />
              <Issues items={data.warnings} tone="warning" />
            </>
          )}

          {hasExisting && (
            <label className={`flex items-start gap-2 text-sm ${canReplace ? 'text-gray-700' : 'text-gray-400'}`}>
              <input
                type="checkbox"
                className="mt-1"
                disabled={!canReplace}
                checked={onConflict === 'replace'}
                onChange={e => setOnConflict(e.target.checked ? 'replace' : 'reject')}
              />
              <span>
                Replace existing policies with the same name (resets them to Draft / Observe)
                {!canReplace && <span className="block text-xs">Requires permission to edit policies.</span>}
              </span>
            </label>
          )}

          {doImport.error && <p className="text-sm text-red-600">{doImport.error.message}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={!data?.valid || doImport.isPending}>
              {doImport.isPending ? 'Importing…' : `Import ${plan.length || ''} ${plan.length === 1 ? 'policy' : 'policies'}`.replace(/\s+/g, ' ')}
            </Button>
          </div>
        </div>
      </Modal>
      {dialog}
    </>
  )
}
