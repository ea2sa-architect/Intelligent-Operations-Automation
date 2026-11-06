import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { useAuth } from '../components/AuthGuard'
import { PasswordInput } from '../components/ui/PasswordInput'

// AUTH-301 — splash login screen. Generic error message only (never echoes
// which part was wrong, never logs/retains the password), redirects an
// already-authenticated user straight past the form.
export function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const { status, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  if (status === 'authenticated') {
    return <Navigate to={location.state?.from?.pathname ?? '/'} replace />
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username, password)
      navigate(location.state?.from?.pathname ?? '/', { replace: true })
    } catch {
      setError('Invalid username or password')
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-600 mb-4">
            <ShieldCheck size={28} className="text-white" />
          </div>
          <h1 className="text-lg font-bold text-indigo-600 tracking-wide uppercase">IOA Governance</h1>
          <p className="text-sm text-gray-400 mt-1">Sign in to continue</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
          <div>
            <label htmlFor="username" className="block text-xs font-medium text-gray-600 mb-1">Username</label>
            <input
              id="username" name="username" type="text" autoComplete="username" required autoFocus
              value={username} onChange={e => setUsername(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>
          <div>
            <label htmlFor="password" className="block text-xs font-medium text-gray-600 mb-1">Password</label>
            <PasswordInput
              id="password" name="password" autoComplete="current-password" required
              value={password} onChange={e => setPassword(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <button
            type="submit" disabled={submitting}
            className="w-full rounded-md bg-indigo-600 text-white text-sm font-medium py-2 hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
