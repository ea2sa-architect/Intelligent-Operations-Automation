import { cn } from '../../lib/utils'

const variants = {
  primary:   'bg-indigo-600 text-white hover:bg-indigo-700',
  secondary: 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50',
  danger:    'bg-red-600 text-white hover:bg-red-700',
  ghost:     'text-gray-600 hover:bg-gray-100',
}

export function Button({ children, variant = 'primary', size = 'md', className, ...props }) {
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  return (
    <button
      className={cn('inline-flex items-center gap-2 rounded-md font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed', variants[variant], sizes[size], className)}
      {...props}
    >
      {children}
    </button>
  )
}
