import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

let perms = ['policy:read', 'policy:edit', 'policy:import']
vi.mock('../lib/api', () => ({
  governance: {
    listPolicies: vi.fn(),
    validateBundle: vi.fn(),
    importBundle: vi.fn(),
    exportBundle: vi.fn(),
  },
  workflowGovernance: { listWorkflows: vi.fn().mockResolvedValue([]) },
  inference: {},
  platforms: { list: vi.fn().mockResolvedValue([]) },
  mcp: {},
  downloadJson: vi.fn(),
}))
vi.mock('../components/AuthGuard', () => ({
  useAuth: () => ({ user: { username: 'tester', permissions: perms }, hasPermission: a => perms.includes(a) }),
}))

import { governance, downloadJson } from '../lib/api'
import { Governance } from './Governance'

const BUNDLE = { schema: 'ioa.policy-bundle/v1', policies: [{ name: 'PII Output Protection', requested_mode: 'enforce', rules: [], bindings: [] }] }
// The modal's submit button ("Import 1 policy" / "Import policies"), as opposed to the page's own "Import".
const SUBMIT = /^Import (\d+ )?(policy|policies)$/
const file = (obj, name = 'bundle.json') => new File([typeof obj === 'string' ? obj : JSON.stringify(obj)], name, { type: 'application/json' })
const PLAN = (action = 'create', extra = {}) => ({ name: 'PII Output Protection', action, rules: 2, bindings: 1, requested_mode: 'enforce', effective_mode: 'observe', existing: null, ...extra })
const OK = (action) => ({ valid: true, errors: [], warnings: [{ path: 'policies[0].requested_mode', message: 'requests "enforce"; it will be imported as Draft / Observe' }], plan: [PLAN(action)] })

async function upload(f) {
  renderWithProviders(<Governance />)
  await userEvent.upload(await screen.findByTestId('bundle-file'), f)
}

beforeEach(() => {
  vi.clearAllMocks()
  perms = ['policy:read', 'policy:edit', 'policy:import']
  governance.listPolicies.mockResolvedValue([])
})

describe('Governance — policy bundle import', () => {
  it('hides Import without policy:import but still offers Export', async () => {
    perms = ['policy:read']
    renderWithProviders(<Governance />)
    expect(await screen.findByRole('button', { name: /Export/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument()
    expect(screen.queryByTestId('bundle-file')).not.toBeInTheDocument()
  })

  it('previews a valid file, says it will land as Draft / Observe, then imports on confirm', async () => {
    governance.validateBundle.mockResolvedValue(OK('create'))
    governance.importBundle.mockResolvedValue({ imported: [{ name: 'PII Output Protection', id: 'p1', action: 'created' }] })
    await upload(file(BUNDLE))

    expect(await screen.findByRole('heading', { name: 'Import Policy Bundle' })).toBeInTheDocument()
    expect(governance.validateBundle).toHaveBeenCalledWith(BUNDLE, 'reject')
    expect(await screen.findByText('PII Output Protection')).toBeInTheDocument()
    expect(screen.getByText(/created as/i)).toBeInTheDocument()
    expect(screen.getByText(/requests "enforce"/)).toBeInTheDocument()
    expect(governance.importBundle).not.toHaveBeenCalled() // nothing is written until confirmed

    await userEvent.click(await screen.findByRole('button', { name: SUBMIT }))
    expect(governance.importBundle).toHaveBeenCalledWith(BUNDLE, 'reject')
    expect(await screen.findByText(/Imported 1 policy as Draft \/ Observe/)).toBeInTheDocument()
  })

  it('lists server errors and disables Import when the bundle is invalid', async () => {
    governance.validateBundle.mockResolvedValue({
      valid: false, warnings: [], plan: [],
      errors: [{ path: 'policies[0].rules[0].rule_type', message: 'unknown rule type "made_up"' }],
    })
    await upload(file(BUNDLE))
    expect(await screen.findByText(/unknown rule type "made_up"/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SUBMIT })).toBeDisabled()
  })

  it('rejects a name collision by default; replacing is opt-in and needs a confirm', async () => {
    governance.validateBundle.mockImplementation(async (_b, mode) =>
      mode === 'replace'
        ? { valid: true, errors: [], warnings: [], plan: [PLAN('replace', { existing: { status: 'active', enforcement_mode: 'enforce' } })] }
        : { valid: false, warnings: [], plan: [PLAN('conflict')], errors: [{ path: 'policies[0].name', message: 'a policy named "PII Output Protection" already exists' }] })
    governance.importBundle.mockResolvedValue({ imported: [{ name: 'PII Output Protection', id: 'p1', action: 'replaced' }] })
    await upload(file(BUNDLE))

    expect(await screen.findByText(/already exists/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: SUBMIT })).toBeDisabled()

    await userEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(governance.validateBundle).toHaveBeenLastCalledWith(BUNDLE, 'replace'))
    await userEvent.click(await screen.findByRole('button', { name: SUBMIT }))

    // the confirm spells out that the live policy will stop being enforced
    expect(await screen.findByText(/currently active \/ enforce/)).toBeInTheDocument()
    expect(governance.importBundle).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Replace' }))
    expect(governance.importBundle).toHaveBeenCalledWith(BUNDLE, 'replace')
  })

  it('disables the replace option for someone without policy:edit', async () => {
    perms = ['policy:read', 'policy:import']
    governance.validateBundle.mockResolvedValue({ valid: false, warnings: [], errors: [], plan: [PLAN('conflict')] })
    await upload(file(BUNDLE))
    expect(await screen.findByRole('checkbox')).toBeDisabled()
    expect(screen.getByText(/Requires permission to edit policies/)).toBeInTheDocument()
  })

  it('shows an inline error for a file that is not JSON, without calling the server', async () => {
    await upload(file('{ nope', 'broken.json'))
    expect(await screen.findByText(/broken.json is not valid JSON/)).toBeInTheDocument()
    expect(governance.validateBundle).not.toHaveBeenCalled()
  })
})

describe('Governance — policy bundle export', () => {
  it('downloads the bundle for the current filter', async () => {
    governance.exportBundle.mockResolvedValue({ ...BUNDLE, exported_at: '2026-11-05T00:00:00Z' })
    renderWithProviders(<Governance />)
    await userEvent.click(await screen.findByRole('button', { name: /Export/ }))
    await waitFor(() => expect(downloadJson).toHaveBeenCalledWith(expect.objectContaining({ schema: 'ioa.policy-bundle/v1' }), 'ioa-policy-bundle-2026-11-05.json'))
    expect(governance.exportBundle).toHaveBeenCalledWith({ status: undefined })
  })

  it('does not silently drop legacy rules: asks first, then re-exports with skipLegacy', async () => {
    governance.exportBundle
      .mockRejectedValueOnce(new Error('Some policies contain legacy (condition_json) rules that a bundle cannot represent.'))
      .mockResolvedValueOnce({ ...BUNDLE, exported_at: '2026-11-05T00:00:00Z' })
    renderWithProviders(<Governance />)
    await userEvent.click(await screen.findByRole('button', { name: /Export/ }))

    expect(await screen.findByText(/would leave those rules out/)).toBeInTheDocument()
    expect(downloadJson).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Export without them' }))
    await waitFor(() => expect(governance.exportBundle).toHaveBeenLastCalledWith({ status: undefined, skipLegacy: true }))
    expect(downloadJson).toHaveBeenCalled()
  })

  it('shows other export failures inline', async () => {
    governance.exportBundle.mockRejectedValue(new Error('No policies match'))
    renderWithProviders(<Governance />)
    await userEvent.click(await screen.findByRole('button', { name: /Export/ }))
    expect(await screen.findByText('No policies match')).toBeInTheDocument()
  })
})

describe('Governance — unevaluated rules', () => {
  it('flags a policy that holds rules the platform does not evaluate', async () => {
    governance.listPolicies.mockResolvedValue([
      { id: 'a', name: 'Has no-op rule', status: 'active', version: 2, created_at: '2026-01-01', open_violations: 0, unevaluated_rule_types: ['execution_rate'] },
      { id: 'b', name: 'Clean policy', status: 'active', version: 1, created_at: '2026-01-01', open_violations: 0, unevaluated_rule_types: [] },
    ])
    renderWithProviders(<Governance />)
    expect(await screen.findByText('Has no-op rule')).toBeInTheDocument()
    expect(screen.getAllByText('unevaluated rules')).toHaveLength(1)
  })
})
