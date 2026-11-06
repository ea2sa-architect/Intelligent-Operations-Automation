import { AlertTriangle } from 'lucide-react'
import { Button } from './Button'

export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onClick={e => e.target === e.currentTarget && onCancel()}
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-red-50 rounded-lg shrink-0">
            <AlertTriangle size={20} className="text-red-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-700 text-white border-red-600 hover:border-red-700"
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
