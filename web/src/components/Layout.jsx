import { useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Shield, Brain, ClipboardList, AlertTriangle, Activity, AlertOctagon, ShieldCheck, Server,
  LayoutDashboard, GitBranch, TrendingUp, Settings, Tag, Plug, Clock, Gauge, Code2, FlaskConical, ScrollText, Share2, ShieldAlert,
  ChevronDown, ChevronRight, Menu, X, LogOut, Users, KeyRound, DollarSign,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuth } from './AuthGuard'
import { ChangePasswordModal } from './ChangePasswordModal'
import { version as APP_VERSION } from '../../package.json'

// AUTH-106 — signs the user out and returns to the login screen.
function UserFooter() {
  const { user, canWrite, logout } = useAuth()
  const navigate = useNavigate()
  const [showChangePassword, setShowChangePassword] = useState(false)

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-xs text-gray-500 truncate">{user?.username}</span>
        {/* AUTH-505 — guest (read-only) sessions get a visible reminder;
            server-side enforcement is what actually blocks writes (see
            require-auth.js), this is just so a 403 isn't a surprise. */}
        {!canWrite && (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-amber-700 bg-amber-100 rounded px-1.5 py-0.5">
            Read-only
          </span>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => setShowChangePassword(true)}
          title="Change password"
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          <KeyRound size={13} />
        </button>
        <button
          onClick={handleLogout}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 transition-colors"
        >
          <LogOut size={13} /> Sign out
        </button>
      </div>
      {showChangePassword && <ChangePasswordModal onClose={() => setShowChangePassword(false)} />}
    </div>
  )
}

// Platform structure: five pillars, each a collapsible nav group. Dashboard and
// Administration sit outside the pillars (platform-level, not pillar-specific).
const pillars = [
  { key: 'governance', label: 'Governance', items: [
      { to: '/governance',   label: 'Policies',    icon: Shield },
      { to: '/violations',   label: 'Violations',  icon: AlertOctagon },
      { to: '/enforcement',  label: 'Enforcement', icon: Gauge },
      { to: '/mcp-registry', label: 'MCP Registry', icon: Server },
  ] },
  { key: 'risk', label: 'Risk', items: [
      { to: '/workflows', label: 'Workflows', icon: GitBranch },
  ] },
  { key: 'assurance', label: 'Assurance', items: [
      { to: '/assurance', label: 'Assurance',     icon: ShieldCheck },
      { to: '/lineage',   label: 'Data Lineage',      icon: Share2 },
      { to: '/anomaly',   label: 'Anomaly Detection', icon: ShieldAlert },
  ] },
  { key: 'runtime', label: 'Runtime Intelligence', items: [
      { to: '/telemetry',  label: 'Telemetry',    icon: Activity },
      { to: '/inference',  label: 'AI Inference', icon: Brain },
      { to: '/audit',      label: 'Audit',        icon: ClipboardList },
      { to: '/escalation', label: 'Escalation',   icon: AlertTriangle },
  ] },
  { key: 'business', label: 'Business Value', items: [
      { to: '/roi', label: 'ROI Intelligence', icon: TrendingUp },
  ] },
]

// Admin sub-items — add entries here to extend the sidebar Administration section
const adminNav = [
  { to: '/admin/tags',         label: 'Tags',         icon: Tag  },
  { to: '/admin/waivers',      label: 'Waivers',      icon: Clock },
  { to: '/admin/approval-chains', label: 'Approval Chains', icon: GitBranch },
  { to: '/admin/integrations', label: 'Integrations', icon: Plug },
  { to: '/admin/users',        label: 'Users',         icon: Users, requiresPermission: 'user:manage' },
  { to: '/admin/budgets',       label: 'Usage Budgets', icon: DollarSign, adminOnly: true },
  { to: '/admin/control-tests',    label: 'Control Tests',    icon: FlaskConical, adminOnly: true },
  { to: '/admin/prompt-registry', label: 'Prompt Registry', icon: ScrollText,   adminOnly: true },
  { to: '/admin/api-docs',        label: 'API Docs',        icon: Code2, adminOnly: true },
]

const navExpandedKey = key => `ioa:nav-expanded:${key}`
const ADMIN_EXPANDED_KEY = navExpandedKey('admin')

function NavGroup({ groupKey, label, items, isActiveGroup, expanded, onToggle, onNavClick }) {
  return (
    <div className="pt-3 border-t border-gray-100 mt-2 first:border-0 first:mt-0 first:pt-0">
      <button
        onClick={onToggle}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActiveGroup
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100'
        )}
      >
        <span className="flex-1 text-left uppercase tracking-wide text-xs font-semibold">{label}</span>
        {expanded
          ? <ChevronDown size={13} className="text-gray-400" />
          : <ChevronRight size={13} className="text-gray-400" />}
      </button>
      {expanded && (
        <div className="mt-0.5 space-y-0.5">
          {items.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={onNavClick}
              className={({ isActive }) => cn(
                'flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-md text-sm transition-colors',
                isActive
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
              )}
            >
              <Icon size={13} />
              {label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function SidebarNav({ onNavClick, isInAdmin, adminExpanded, onToggleAdmin, groupState, onToggleGroup, visibleAdminNav }) {
  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
      <NavLink
        to="/"
        end
        onClick={onNavClick}
        className={({ isActive }) => cn(
          'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
          isActive
            ? 'bg-indigo-50 text-indigo-700 font-medium'
            : 'text-gray-600 hover:bg-gray-100'
        )}
      >
        <LayoutDashboard size={16} />
        Dashboard
      </NavLink>

      {pillars.map(({ key, label, items }) => (
        <NavGroup
          key={key}
          groupKey={key}
          label={label}
          items={items}
          isActiveGroup={groupState[key].isActive}
          expanded={groupState[key].expanded}
          onToggle={() => onToggleGroup(key)}
          onNavClick={onNavClick}
        />
      ))}

      {/* Administration — collapsible, persisted in localStorage */}
      <div className="pt-3 border-t border-gray-100 mt-2">
        <button
          onClick={onToggleAdmin}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
            isInAdmin
              ? 'bg-indigo-50 text-indigo-700 font-medium'
              : 'text-gray-600 hover:bg-gray-100'
          )}
        >
          <Settings size={16} />
          <span className="flex-1 text-left">Administration</span>
          {adminExpanded
            ? <ChevronDown size={13} className="text-gray-400" />
            : <ChevronRight size={13} className="text-gray-400" />}
        </button>
        {adminExpanded && (
          <div className="mt-0.5 space-y-0.5">
            {visibleAdminNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={onNavClick}
                className={({ isActive }) => cn(
                  'flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-md text-sm transition-colors',
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 font-medium'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
                )}
              >
                <Icon size={13} />
                {label}
              </NavLink>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}

export function Layout() {
  const location  = useLocation()
  const isInAdmin = location.pathname.startsWith('/admin')
  const { user, hasPermission } = useAuth()
  const isAdmin = user?.roles?.includes('admin') || user?.roles?.includes('platform-admin')
  const visibleAdminNav = adminNav.filter(item => {
    if (item.adminOnly) return isAdmin
    if (item.requiresPermission) return hasPermission(item.requiresPermission)
    return true
  })

  const [drawerOpen,    setDrawerOpen]    = useState(false)
  const [adminExpanded, setAdminExpanded] = useState(
    () => isInAdmin || localStorage.getItem(ADMIN_EXPANDED_KEY) === 'true'
  )

  const isGroupActive = items => items.some(({ to }) => location.pathname.startsWith(to))

  const [expandedGroups, setExpandedGroups] = useState(() =>
    Object.fromEntries(pillars.map(({ key, items }) =>
      [key, isGroupActive(items) || localStorage.getItem(navExpandedKey(key)) === 'true']
    ))
  )

  function toggleAdmin() {
    setAdminExpanded(v => {
      const next = !v
      localStorage.setItem(ADMIN_EXPANDED_KEY, String(next))
      return next
    })
  }

  function toggleGroup(key) {
    setExpandedGroups(prev => {
      const next = !prev[key]
      localStorage.setItem(navExpandedKey(key), String(next))
      return { ...prev, [key]: next }
    })
  }

  const groupState = Object.fromEntries(pillars.map(({ key, items }) => [
    key,
    { expanded: expandedGroups[key], isActive: isGroupActive(items) },
  ]))

  const sharedNavProps = {
    isInAdmin,
    adminExpanded,
    onToggleAdmin: toggleAdmin,
    groupState,
    onToggleGroup: toggleGroup,
    visibleAdminNav,
  }

  return (
    <div className="flex h-screen bg-gray-50">

      {/* ── Desktop sidebar (md+) ── */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-200 flex-col shrink-0">
        <div className="px-6 py-5 border-b border-gray-200 flex items-baseline gap-2">
          <span className="text-sm font-bold text-indigo-600 tracking-wide uppercase">IOA Governance</span>
          <span className="text-[10px] font-medium text-gray-400 tabular-nums">v{APP_VERSION}</span>
        </div>
        <SidebarNav onNavClick={() => {}} {...sharedNavProps} />
        <UserFooter />
      </aside>

      {/* ── Mobile drawer backdrop ── */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* ── Mobile drawer ── */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform duration-200 ease-in-out md:hidden',
          drawerOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Navigation"
      >
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
          <span className="flex items-baseline gap-2">
            <span className="text-sm font-bold text-indigo-600 tracking-wide uppercase">IOA Governance</span>
            <span className="text-[10px] font-medium text-gray-400 tabular-nums">v{APP_VERSION}</span>
          </span>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>
        <SidebarNav onNavClick={() => setDrawerOpen(false)} {...sharedNavProps} />
        <UserFooter />
      </aside>

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile top bar */}
        <div className="md:hidden flex items-center gap-3 px-4 py-3 bg-white border-b border-gray-200 shrink-0">
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-1 text-gray-500 hover:text-gray-700 transition-colors"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
          <span className="text-sm font-bold text-indigo-600 tracking-wide uppercase">IOA Governance</span>
        </div>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
