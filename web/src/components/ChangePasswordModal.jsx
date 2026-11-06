// Self-service password change — replaces the manual DB-hash-sync that was
// previously the only way to change a password. Requires the current
// password (unlike the admin reset in Admin > Users), verified server-side.
import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { auth } from '../lib/api'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Label } from './ui/Input'
import { PasswordInput } from './ui/PasswordInput'

export function ChangePasswordModal({ onClose }) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [done, setDone] = useState(false)

  const change = useMutation({
    mutationFn: () => auth.changePassword(currentPassword, newPassword),
    onSuccess:  () => setDone(true),
  })

  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword

  return (
    <Modal title="Change Password" onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">Password changed.</p>
          <Button size="sm" onClick={onClose}>Close</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="current-password">Current Password</Label>
            <PasswordInput
              id="current-password" autoFocus
              value={currentPassword} onChange={e => setCurrentPassword(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="new-password-self">New Password</Label>
            <PasswordInput
              id="new-password-self"
              value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div>
            <Label htmlFor="confirm-password-self">Confirm New Password</Label>
            <PasswordInput
              id="confirm-password-self"
              value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
            />
            {mismatch && <p className="text-xs text-red-600 mt-1">Passwords don't match</p>}
          </div>
          <Button
            disabled={!currentPassword || newPassword.length < 8 || newPassword !== confirmPassword || change.isPending}
            onClick={() => change.mutate()}
          >
            {change.isPending ? 'Changing…' : 'Change Password'}
          </Button>
          {change.error && <p className="text-sm text-red-600">{change.error.message}</p>}
        </div>
      )}
    </Modal>
  )
}
