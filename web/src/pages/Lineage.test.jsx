import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../test/render'

vi.mock('../lib/api', () => ({
  lineage: {
    listChains:     vi.fn(),
    getChain:       vi.fn(),
    buildChain:     vi.fn(),
    listViolations: vi.fn(),
  },
}))

import { lineage } from '../lib/api'
import { Lineage } from './Lineage'

const CHAIN = {
  correlation_id: 'corr-1', node_count: 2, external_count: 1,
  classifications: ['pii'], regions: [], chain_start: '2026-10-09T00:00:00Z',
}
const MODEL_NODE = {
  id: 'node-1', node_type: 'model', node_id: 'good-model', node_name: 'good-model',
  service_name: 'ai-inference-service', data_classification: 'pii', is_external: true, data_region: null,
  n8n: {
    workflow_id: 'n8n-wf-1', workflow_name: 'Invoice Review', execution_id: 'exec-4821',
    node_name: 'OpenAI — Summarize Invoice',
    execution_url: 'https://ea2sa.app.n8n.cloud/workflow/n8n-wf-1/executions/exec-4821',
  },
}
const PLAIN_NODE = {
  id: 'node-2', node_type: 'workflow', node_id: 'wf-1', node_name: 'Invoice Review',
  service_name: 'workflow-governance-service', data_classification: 'internal', is_external: false, data_region: null,
  n8n: null,
}

beforeEach(() => vi.clearAllMocks())

describe('Lineage — node detail and n8n deep link', () => {
  it('clicking a node row opens the detail panel with workflow/execution/node and an Open in n8n link', async () => {
    lineage.listChains.mockResolvedValue([CHAIN])
    lineage.listViolations.mockResolvedValue([])
    lineage.getChain.mockResolvedValue({ nodes: [MODEL_NODE], edges: [] })

    renderWithProviders(<Lineage />)
    await userEvent.click(await screen.findByText('corr-1'))
    // "good-model" renders both in the SVG DAG node and the node table row —
    // either click bubbles to the same onClick, so just take the first.
    const nodeLabels = await screen.findAllByText('good-model')
    await userEvent.click(nodeLabels[0])

    expect(await screen.findByText('Invoice Review')).toBeInTheDocument()
    expect(screen.getByText('#exec-4821')).toBeInTheDocument()
    expect(screen.getByText('OpenAI — Summarize Invoice')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: /Open in n8n/i })
    expect(link).toHaveAttribute('href', 'https://ea2sa.app.n8n.cloud/workflow/n8n-wf-1/executions/exec-4821')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('shows a fallback message and no link for a node with no n8n linkage', async () => {
    lineage.listChains.mockResolvedValue([CHAIN])
    lineage.listViolations.mockResolvedValue([])
    lineage.getChain.mockResolvedValue({ nodes: [PLAIN_NODE], edges: [] })

    renderWithProviders(<Lineage />)
    await userEvent.click(await screen.findByText('corr-1'))
    await userEvent.click(await screen.findAllByText('Invoice Review').then(els => els[0]))

    expect(await screen.findByText(/No n8n execution linked/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open in n8n/i })).not.toBeInTheDocument()
  })

  it('clicking a lineage violation expands its correlation chain', async () => {
    lineage.listChains.mockResolvedValue([CHAIN])
    lineage.listViolations.mockResolvedValue([
      { id: 'v-1', entity_id: 'corr-1', message: 'External processor detected in correlation chain corr-1: good-model' },
    ])
    lineage.getChain.mockResolvedValue({ nodes: [MODEL_NODE], edges: [] })

    renderWithProviders(<Lineage />)
    await userEvent.click(await screen.findByText(/External processor detected/i))

    // The chain's detail panel (DAG/table) only renders once expanded;
    // "good-model" appears twice (SVG node + table row) once it does.
    expect(await screen.findAllByText('good-model')).not.toHaveLength(0)
  })
})
