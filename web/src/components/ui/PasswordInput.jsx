import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Input } from './Input'

// Reveal-password toggle, used everywhere a password gets typed (login,
// self-service change, admin reset, create user) — one component so the
// behavior and styling stay identical across all of them.
export function PasswordInput({ className, ...props }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={cn('pr-9', className)} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible(v => !v)}
        title={visible ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  )
}
