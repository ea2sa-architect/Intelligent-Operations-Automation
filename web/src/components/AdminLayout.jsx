import { NavLink, Outlet } from 'react-router-dom'
import { Tag, Plug, Clock, GitBranch, Code2, FlaskConical, ScrollText, Users } from 'lucide-react'
import { useAuth } from './AuthGuard'

// Admin sub-nav items — add new entries here to extend the Administration section
const adminNav = [
  { to: '/admin/tags',         label: 'Tags',         icon: Tag,  description: 'Govern tag roles, risk scores, and folder taxonomy' },
  { to: '/admin/waivers',      label: 'Waivers',      icon: Clock, description: 'Pending waiver approvals and expiry countdown' },
  { to: '/admin/approval-chains', label: 'Approval Chains', icon: GitBranch, description: 'Multi-stage, quorum-based approval per risk tier' },
  { to: '/admin/integrations', label: 'Integrations', icon: Plug, description: 'Configure platform connections — n8n, Make.com, Zapier, Power Automate' },
  { to: '/admin/users',        label: 'Users',         icon: Users, description: 'Create accounts, assign roles, and manage platform access', requiresPermission: 'user:manage' },
  { to: '/admin/control-tests',    label: 'Control Tests',    icon: FlaskConical, description: 'Continuous control testing dashboard — pass rates, run history, and violations', adminOnly: true },
  { to: '/admin/prompt-registry', label: 'Prompt Registry', icon: ScrollText,   description: 'Governed prompt templates with approval lifecycle and drift detection', adminOnly: true },
  { to: '/admin/api-docs',        label: 'API Docs',        icon: Code2, description: 'OpenAPI documentation for all platform services', adminOnly: true },
]

export function AdminLayout() {
  const { user, hasPermission } = useAuth()
  const isAdmin = user?.roles?.includes('admin') || user?.roles?.includes('platform-admin')
  const visibleNav = adminNav.filter(item => {
    if (item.adminOnly) return isAdmin
    if (item.requiresPermission) return hasPermission(item.requiresPermission)
    return true
  })

  return (
    <div className="space-y-6">
      {/* Section header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Administration</h1>
        <p className="text-sm text-gray-500 mt-1">Platform configuration and governance settings</p>
      </div>

      {/* Horizontal sub-nav */}
      <div className="flex gap-1 border-b border-gray-200">
        {visibleNav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-b-2 border-indigo-600 text-indigo-700 font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`
            }
          >
            <Icon size={14} />
            {label}
          </NavLink>
        ))}
      </div>

      {/* Page content */}
      <Outlet />
    </div>
  )
}
