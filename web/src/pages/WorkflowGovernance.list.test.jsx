import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

vi.mock('../lib/api', () => ({
  workflowGovernance: {
    listWorkflows: vi.fn(),
    riskSummary:   vi.fn().mockResolvedValue({}),
    discover:      vi.fn(),
    clearAll:      vi.fn(),
    riskNodes:     vi.fn(),
    riskByDomain:  vi.fn(),
  },
  governance: {
    violationSummary: vi.fn().mockResolvedValue([]),
    evaluateWorkflow: vi.fn(),
  },
  platforms: { list: vi.fn().mockResolvedValue([]) },
  tags:      { list: vi.fn().mockResolvedValue([]) },
}))
const mockHasPermission = vi.fn(() => true)
vi.mock('../components/AuthGuard', () => ({
  useAuth: () => ({ user: { username: 'tester', roles: [], permissions: [] }, hasPermission: mockHasPermission }),
}))

import { workflowGovernance } from '../lib/api'
import { WorkflowGovernance } from './WorkflowGovernance'

const WORKFLOW = {
  id: 'wf-1', name: 'Nightly ETL', n8n_id: 'wf-1', platform: 'n8n', active: true,
  risk_score: 72, risk_level: 'HIGH', scored_at: '2026-06-01T00:00:00Z',
  policies_applied: true, tags: [],
}

async function openWorkflowsTab() {
  renderWithProviders(<WorkflowGovernance />)
  // The tab button's accessible name also picks up its adjacent InfoTip's
  // "More information" label, so match on the leading text instead of exactly.
  await userEvent.click(await screen.findByRole('button', { name: /^Workflows/ }))
}

beforeEach(() => vi.clearAllMocks())

describe('WorkflowGovernance — Workflows tab list states', () => {
  it('shows a loading state while the list is in flight', async () => {
    let resolveList
    workflowGovernance.listWorkflows.mockReturnValue(new Promise(r => { resolveList = r }))

    await openWorkflowsTab()
    expect(await screen.findByText(/Loading/i)).toBeInTheDocument()

    resolveList([])
  })

  it('renders workflows returned by the API', async () => {
    workflowGovernance.listWorkflows.mockResolvedValue([WORKFLOW])

    await openWorkflowsTab()
    expect(await screen.findByText('Nightly ETL')).toBeInTheDocument()
  })

  it('shows the empty-state message when the list resolves with no workflows', async () => {
    workflowGovernance.listWorkflows.mockResolvedValue([])

    await openWorkflowsTab()
    expect(await screen.findByText(/No workflows found/i)).toBeInTheDocument()
  })

  // Characterization, not an endorsement: the Workflows tab has no error UI
  // for a failed list fetch — listWorkflows() rejecting is indistinguishable
  // from it resolving empty, so a real outage silently reads as "you have no
  // workflows, go discover some" instead of surfacing an error. Pinned here
  // so a future fix is a deliberate change to this test, not an accident.
  it('currently falls back to the empty-state message (not an error message) when the list fetch fails', async () => {
    workflowGovernance.listWorkflows.mockRejectedValue(new Error('workflow-governance-service unreachable'));

    await openWorkflowsTab()
    expect(await screen.findByText(/No workflows found/i)).toBeInTheDocument()
    expect(screen.queryByText(/unreachable/i)).not.toBeInTheDocument()
  })

  it('triggers a discovery run and shows the resulting count', async () => {
    workflowGovernance.listWorkflows.mockResolvedValue([])
    workflowGovernance.discover.mockResolvedValue({ discovered: 3, workflows: [] })

    renderWithProviders(<WorkflowGovernance />)
    await userEvent.click(screen.getByRole('button', { name: /Discover Workflows/i }))

    expect(await screen.findByText(/Discovered 3 workflows from n8n/i)).toBeInTheDocument()
    expect(workflowGovernance.discover).toHaveBeenCalled()
  })

  it('shows the discover error message when discovery fails', async () => {
    workflowGovernance.listWorkflows.mockResolvedValue([])
    workflowGovernance.discover.mockRejectedValue(new Error('n8n API key not configured'))

    renderWithProviders(<WorkflowGovernance />)
    await userEvent.click(screen.getByRole('button', { name: /Discover Workflows/i }))

    expect(await screen.findByText(/n8n API key not configured/i)).toBeInTheDocument()
  })

  it('re-fetches with a risk_level filter applied', async () => {
    workflowGovernance.listWorkflows.mockResolvedValue([])

    await openWorkflowsTab()
    await waitFor(() => expect(workflowGovernance.listWorkflows).toHaveBeenCalled())

    // The Risk <Select> has no label association, but its placeholder option
    // text ("All levels") is unique among the tab's filter selects, so
    // getByDisplayValue locates it reliably.
    const riskSelect = await screen.findByDisplayValue('All levels')
    await userEvent.selectOptions(riskSelect, 'HIGH')

    await waitFor(() => {
      const lastCall = workflowGovernance.listWorkflows.mock.calls.at(-1)[0]
      expect(lastCall).toMatchObject({ risk_level: 'HIGH' })
    })
  })
})

describe('WorkflowGovernance — Clear All (workflow:manage only)', () => {
  it('is hidden for a user without workflow:manage', async () => {
    mockHasPermission.mockReturnValueOnce(false)
    workflowGovernance.riskSummary.mockResolvedValueOnce({ total_workflows: 5 })

    renderWithProviders(<WorkflowGovernance />)
    await screen.findByText('Workflow Governance')
    expect(screen.queryByRole('button', { name: /Clear All/i })).not.toBeInTheDocument()
  })

  it('is disabled when there are no workflows to clear', async () => {
    workflowGovernance.riskSummary.mockResolvedValueOnce({ total_workflows: 0 })
    renderWithProviders(<WorkflowGovernance />)
    expect(await screen.findByRole('button', { name: /Clear All/i })).toBeDisabled()
  })

  it('asks for confirmation and, once confirmed, deletes all workflows', async () => {
    workflowGovernance.riskSummary.mockResolvedValueOnce({ total_workflows: 5 })
    workflowGovernance.clearAll.mockResolvedValueOnce({ deleted: 5 })

    renderWithProviders(<WorkflowGovernance />)
    await userEvent.click(await screen.findByRole('button', { name: /Clear All/i }))

    expect(await screen.findByText(/Clear All Workflows/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Delete All' }))

    expect(workflowGovernance.clearAll).toHaveBeenCalled()
    expect(await screen.findByText(/Deleted 5 workflows/i)).toBeInTheDocument()
  })

  it('does not call clearAll when the confirmation is cancelled', async () => {
    workflowGovernance.riskSummary.mockResolvedValueOnce({ total_workflows: 5 })

    renderWithProviders(<WorkflowGovernance />)
    await userEvent.click(await screen.findByRole('button', { name: /Clear All/i }))
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))

    expect(workflowGovernance.clearAll).not.toHaveBeenCalled()
  })

  it('shows an error message when clearAll fails', async () => {
    workflowGovernance.riskSummary.mockResolvedValueOnce({ total_workflows: 5 })
    workflowGovernance.clearAll.mockRejectedValueOnce(new Error('Internal service callers only'))

    renderWithProviders(<WorkflowGovernance />)
    await userEvent.click(await screen.findByRole('button', { name: /Clear All/i }))
    await userEvent.click(screen.getByRole('button', { name: 'Delete All' }))

    expect(await screen.findByText(/Internal service callers only/i)).toBeInTheDocument()
  })
})
