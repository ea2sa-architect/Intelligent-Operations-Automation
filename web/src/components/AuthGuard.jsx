import { createContext, useContext, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { auth } from '../lib/api'

const AuthContext = createContext(null)

export function useAuth() {
  return useContext(AuthContext)
}

// AUTH-303 — restores session state from the httpOnly cookie via /auth/me
// on every app load (including a page refresh), so normal navigation
// doesn't repeatedly require login.
export function AuthProvider({ children }) {
  const [status, setStatus] = useState('loading') // loading | authenticated | unauthenticated
  const [user, setUser] = useState(null)

  useEffect(() => {
    auth.me()
      .then(u => { setUser(u); setStatus('authenticated') })
      .catch(() => setStatus('unauthenticated'))
  }, [])

  async function login(username, password) {
    const u = await auth.login(username, password)
    setUser(u)
    setStatus('authenticated')
    return u
  }

  async function logout() {
    await auth.logout().catch(() => {}) // still clear local state even if the network call fails
    setUser(null)
    setStatus('unauthenticated')
  }

  // AUTH-505, updated for EP-308's named-permission model — the literal
  // 'write' permission from the original coarse read/write scheme
  // (db/migrations/auth/002_roles.sql) is never granted to any role
  // post-EP-308, so checking for it here always evaluated to false. This
  // is a generic "has at least one non-read-only permission" check: every
  // read-type permission is named '<resource>:read' (see
  // services/auth-service/src/lib/permissions.js), so anything else implies
  // some mutating capability. Falls back to true before the user loads, to
  // avoid flashing a read-only banner on an already-authenticated user.
  const canWrite = user ? (user.permissions ?? []).some(p => !p.endsWith(':read')) : true

  // EP-308-S5 — named-permission check for fine-grained UI gating.
  // Falls back to true when no user is loaded (pre-auth loading state) to
  // avoid flashing disabled controls on an already-authenticated user.
  function hasPermission(action) {
    if (!user) return true
    return user.permissions?.includes(action) ?? false
  }

  return (
    <AuthContext.Provider value={{ status, user, canWrite, hasPermission, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// Wraps admin-only routes; non-admin users are silently redirected to the
// dashboard rather than seeing a 403 page.
export function AdminGuard({ children }) {
  const { status, user } = useAuth()
  if (status === 'loading') return null
  if (!user?.roles?.includes('admin') && !user?.roles?.includes('platform-admin')) return <Navigate to="/" replace />
  return children
}

// EP-308-S5 — wraps routes that require a specific named permission.
// Redirects to / rather than showing a 403 so unauthorized users don't
// learn the route exists.
export function PermissionGuard({ permission, children }) {
  const { status, hasPermission } = useAuth()
  if (status === 'loading') return null
  if (!hasPermission(permission)) return <Navigate to="/" replace />
  return children
}

// AUTH-302 — wraps the app's existing routes; unauthenticated users are
// redirected to /login with the intended destination preserved so Login can
// send them back after a successful sign-in.
export function AuthGuard({ children }) {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    // AUTH-303 — no flash of protected content while the session-restore
    // check is in flight.
    return (
      <div className="flex h-screen items-center justify-center bg-gray-50">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (status === 'unauthenticated') {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return children
}
