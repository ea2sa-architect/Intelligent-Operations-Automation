import { cn } from '../../lib/utils'

export function Table({ children, className }) {
  return (
    <div className="overflow-x-auto">
      <table className={cn('w-full text-sm', className)}>{children}</table>
    </div>
  )
}

export function Th({ children, className }) {
  return <th className={cn('px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide bg-gray-50', className)}>{children}</th>
}

export function Td({ children, className }) {
  return <td className={cn('px-4 py-3 text-gray-700 border-t border-gray-100', className)}>{children}</td>
}

export function Tr({ children, className, onClick }) {
  return <tr className={cn('hover:bg-gray-50 transition-colors', onClick && 'cursor-pointer', className)} onClick={onClick}>{children}</tr>
}
