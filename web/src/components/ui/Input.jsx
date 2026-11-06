import { cn } from '../../lib/utils'

export function Input({ className, ...props }) {
  return (
    <input
      className={cn('w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-gray-50', className)}
      {...props}
    />
  )
}

export function Label({ children, className, ...props }) {
  return <label className={cn('block text-sm font-medium text-gray-700 mb-1', className)} {...props}>{children}</label>
}

export function Select({ children, className, ...props }) {
  return (
    <select className={cn('w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white', className)} {...props}>
      {children}
    </select>
  )
}
