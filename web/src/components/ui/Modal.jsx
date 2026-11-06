import { X } from 'lucide-react'

// size: 'md' (default, max-w-lg) or 'lg' for wide content such as tables.
export function Modal({ title, children, onClose, size = 'md' }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/50"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div className={`bg-white w-full sm:rounded-lg shadow-xl ${size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92dvh] sm:max-h-[90vh] flex flex-col rounded-t-2xl sm:rounded-t-lg`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors p-1 -mr-1">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5 sm:p-6">{children}</div>
      </div>
    </div>
  )
}
