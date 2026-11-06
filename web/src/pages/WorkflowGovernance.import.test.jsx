import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

vi.mock('../lib/api', () => ({
  workflowGovernance: {
    listWorkflows:  vi.fn().mockResolvedValue([]),
    riskSummary:    vi.fn().mockResolvedValue({}),
    discover:       vi.fn(),
    riskNodes:      vi.fn(),
    riskByDomain:   vi.fn(),
    n8nWorkflows:   vi.fn(),
    makeWorkflows:  vi.fn(),
    zapierWorkflows:  vi.fn(),
    camundaWorkflows: vi.fn(),
    importWorkflow:   vi.fn(),
  },
  governance: {
    violationSummary: vi.fn().mockResolvedValue([]),
    evaluateWorkflow: vi.fn(),
  },
  platforms: { list: vi.fn().mockResolvedValue([]) },
  tags:      { list: vi.fn().mockResolvedValue([]) },
}))
vi.mock('../components/AuthGuard', () => ({
  useAuth: () => ({ user: { username: 'tester', roles: [], permissions: [] }, hasPermission: () => true }),
}))

import { workflowGovernance } from '../lib/api'
import { WorkflowGovernance } from './WorkflowGovernance'

const N8N_WORKFLOW = { id: 'wf-n8n-1', name: 'Order Sync', active: true, tags: [] }

async function openImportModal() {
  renderWithProviders(<WorkflowGovernance />)
  await userEvent.click(await screen.findByRole('button', { name: /^Import Workflow/ }))
  // "Import Workflow" is the modal's own <h2> title — waiting on it confirms the modal mounted.
  await screen.findByRole('heading', { name: 'Import Workflow' })
}

beforeEach(() => vi.clearAllMocks())

describe('WorkflowGovernance — Import modal', () => {
  it('lists n8n workflows and lets the user select and submit one', async () => {
    workflowGovernance.n8nWorkflows.mockResolvedValue([N8N_WORKFLOW])
    workflowGovernance.importWorkflow.mockResolvedValue({
      id: 'wf-n8n-1', name: 'Order Sync', risk_score: 61, risk_level: 'HIGH', top_risk_factors: [],
    })

    await openImportModal()

    await userEvent.click(await screen.findByText('Order Sync'))
    await userEvent.click(screen.getByRole('button', { name: /Import & Score/i }))

    expect(workflowGovernance.importWorkflow).toHaveBeenCalledWith({ n8n_id: 'wf-n8n-1' })
    expect(await screen.findByText(/Order Sync imported/i)).toBeInTheDocument()
    expect(screen.getByText('HIGH')).toBeInTheDocument()
  })

  it('disables the submit button until a workflow is selected', async () => {
    workflowGovernance.n8nWorkflows.mockResolvedValue([N8N_WORKFLOW])
    await openImportModal()

    expect(await screen.findByRole('button', { name: /Import & Score/i })).toBeDisabled()
  })

  it('shows the n8n list error message when fetching the workflow list fails', async () => {
    workflowGovernance.n8nWorkflows.mockRejectedValue(new Error('N8N_API_KEY not set'))

    await openImportModal()
    expect(await screen.findByText(/N8N_API_KEY not set/i)).toBeInTheDocument()
  })

  it('shows the empty-list message when n8n has no workflows', async () => {
    workflowGovernance.n8nWorkflows.mockResolvedValue([])

    await openImportModal()
    expect(await screen.findByText(/No workflows found/i)).toBeInTheDocument()
  })

  it('shows the import error message when the import call fails, and lets the user retry', async () => {
    workflowGovernance.n8nWorkflows.mockResolvedValue([N8N_WORKFLOW])
    workflowGovernance.importWorkflow
      .mockRejectedValueOnce(new Error('Workflow wf-n8n-1 not found in n8n'))
      .mockResolvedValueOnce({ id: 'wf-n8n-1', name: 'Order Sync', risk_score: 61, risk_level: 'HIGH', top_risk_factors: [] })

    await openImportModal()
    await userEvent.click(await screen.findByText('Order Sync'))
    await userEvent.click(screen.getByRole('button', { name: /Import & Score/i }))

    expect(await screen.findByText(/not found in n8n/i)).toBeInTheDocument()
    // The modal stays open on failure (no success panel), so the same
    // selection can be resubmitted without re-picking the workflow.
    expect(screen.queryByText(/imported/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Import & Score/i }))
    expect(await screen.findByText(/Order Sync imported/i)).toBeInTheDocument()
  })

  it('submits a Make.com import with the connection and source id once a connection exists', async () => {
    // ImportModal only shows a platform tab (and thus only calls makeWorkflows)
    // once a 'connected' platform_connections row for that platform exists.
    const { platforms } = await import('../lib/api')
    platforms.list.mockResolvedValue([{ id: 'conn-1', platform: 'make', status: 'connected', name: 'Prod Make' }])
    workflowGovernance.makeWorkflows.mockResolvedValue([{ sourceId: '42', name: 'Lead Enrichment', isActive: true }])
    workflowGovernance.importWorkflow.mockResolvedValue({
      id: 'wf-make-1', name: 'Lead Enrichment', risk_score: 30, risk_level: 'LOW', top_risk_factors: [],
    })

    await openImportModal()
    await userEvent.click(await screen.findByRole('button', { name: 'Make.com' }))
    await userEvent.click(await screen.findByText('Lead Enrichment'))
    await userEvent.click(screen.getByRole('button', { name: /Import & Score/i }))

    expect(workflowGovernance.importWorkflow).toHaveBeenCalledWith({
      platform: 'make', connection_id: 'conn-1', source_id: '42',
    })
    expect(await screen.findByText(/Lead Enrichment imported/i)).toBeInTheDocument()
  })
})
