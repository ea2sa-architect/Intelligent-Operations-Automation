import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../../test/render'

vi.mock('../../lib/api', () => ({
  promptRegistry: {
    list:       vi.fn().mockResolvedValue([]),
    create:     vi.fn(),
    update:     vi.fn(),
    approval:   vi.fn(),
    rollback:   vi.fn(),
    checkDrift: vi.fn(),
  },
}))

const mockUseAuth = vi.fn()
vi.mock('../../components/AuthGuard', () => ({ useAuth: () => mockUseAuth() }))

import { PromptRegistry } from './PromptRegistry'

beforeEach(() => vi.clearAllMocks())

// Regression coverage for the canWrite bug: it used to check for a literal
// 'write' permission from the pre-EP-308 coarse model, which no role is ever
// granted anymore — so "New Prompt" was hidden for every user, including
// platform-admin. It's now derived from the real mcp:register permission
// the backend actually requires for these routes (see
// mcp-governance-service/src/routes/prompt-registry.js).
describe('PromptRegistry — governance action visibility', () => {
  it('shows "New Prompt" for a user with mcp:register', async () => {
    mockUseAuth.mockReturnValue({
      user: { username: 'admin', roles: ['platform-admin'], permissions: ['mcp:register', 'mcp:approve'] },
      hasPermission: action => ['mcp:register', 'mcp:approve'].includes(action),
    })

    renderWithProviders(<PromptRegistry />)
    expect(await screen.findByRole('button', { name: /New Prompt/i })).toBeInTheDocument()
  })

  it('hides "New Prompt" for a read-only user (e.g. the auditor role)', async () => {
    mockUseAuth.mockReturnValue({
      user: { username: 'auditor1', roles: ['auditor'], permissions: ['mcp:read', 'policy:read', 'audit:read', 'workflow:read'] },
      hasPermission: action => ['mcp:read', 'policy:read', 'audit:read', 'workflow:read'].includes(action),
    })

    renderWithProviders(<PromptRegistry />)
    // Wait for the list to settle so we're not just catching a pre-render gap.
    await screen.findByText(/Prompt Registry/i)
    expect(screen.queryByRole('button', { name: /New Prompt/i })).not.toBeInTheDocument()
  })

  it('hides "New Prompt" for a security-reviewer, who can register but not necessarily edit prompts either way', async () => {
    // security-reviewer holds mcp:read/register but not mcp:approve — this
    // pins that canWrite tracks mcp:register specifically, not just "any
    // mcp permission at all".
    mockUseAuth.mockReturnValue({
      user: { username: 'reviewer1', roles: ['security-reviewer'], permissions: ['mcp:read', 'policy:read', 'audit:read', 'workflow:read'] },
      hasPermission: action => ['mcp:read', 'policy:read', 'audit:read', 'workflow:read'].includes(action),
    })

    renderWithProviders(<PromptRegistry />)
    await screen.findByText(/Prompt Registry/i)
    expect(screen.queryByRole('button', { name: /New Prompt/i })).not.toBeInTheDocument()
  })
})
