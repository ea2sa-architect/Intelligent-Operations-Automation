import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '../test/render'

vi.mock('../lib/api', () => ({
  auth: { me: vi.fn(), login: vi.fn(), logout: vi.fn() },
}))

import { auth } from '../lib/api'
import { AuthProvider, useAuth } from './AuthGuard'

function Probe() {
  const { canWrite, status } = useAuth()
  if (status === 'loading') return <span>loading</span>
  return <span>canWrite:{String(canWrite)}</span>
}

beforeEach(() => vi.clearAllMocks())

// Regression coverage: canWrite used to check permissions.includes('write'),
// a permission string no role has been granted since EP-308 replaced the
// coarse read/write model with named permissions — see AuthGuard.jsx's
// canWrite comment and CLAUDE.md's Epic 5 section.
describe('AuthProvider — canWrite', () => {
  it('is true for a user holding only named mutating permissions (no literal "write")', async () => {
    auth.me.mockResolvedValue({ username: 'admin', roles: ['platform-admin'], permissions: ['mcp:approve', 'policy:edit'] })

    renderWithProviders(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('canWrite:true')).toBeInTheDocument()
  })

  it('is false for a user holding only :read permissions (the auditor role)', async () => {
    auth.me.mockResolvedValue({ username: 'auditor1', roles: ['auditor'], permissions: ['mcp:read', 'policy:read', 'audit:read', 'workflow:read'] })

    renderWithProviders(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('canWrite:false')).toBeInTheDocument()
  })

  it('is false for a user with no permissions at all', async () => {
    auth.me.mockResolvedValue({ username: 'nobody', roles: [], permissions: [] })

    renderWithProviders(<AuthProvider><Probe /></AuthProvider>)
    expect(await screen.findByText('canWrite:false')).toBeInTheDocument()
  })
})
