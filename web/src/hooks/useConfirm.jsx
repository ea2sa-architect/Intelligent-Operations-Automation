import { useState, useCallback } from 'react'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

export function useConfirm() {
  const [state, setState] = useState(null)

  const confirm = useCallback(({ title, message, confirmLabel }) =>
    new Promise(resolve => setState({ title, message, confirmLabel, resolve })),
  [])

  const handleConfirm = () => { state.resolve(true);  setState(null) }
  const handleCancel  = () => { state.resolve(false); setState(null) }

  const dialog = state
    ? <ConfirmDialog
        title={state.title}
        message={state.message}
        confirmLabel={state.confirmLabel}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    : null

  return { confirm, dialog }
}
