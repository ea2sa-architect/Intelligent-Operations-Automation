// EP-308-S6 — User management admin page. Lists all platform users, lets
// a platform-admin create new accounts, assign roles, and disable accounts.
// Mirrors TagAdmin's table + inline-action pattern; mounted at /admin/users.

import { useState, Fragment } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ShieldCheck, KeyRound, UserCheck } from 'lucide-react'
import { users as usersApi } from '../../lib/api'
import { useAuth } from '../../components/AuthGuard'
import { Card } from '../../components/ui/Card'
import { Table, Th, Td, Tr } from '../../components/ui/Table'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Input, Label, Select } from '../../components/ui/Input'
import { PasswordInput } from '../../components/ui/PasswordInput'
import { useConfirm } from '../../hooks/useConfirm.jsx'

const ALL_ROLES = [
  'platform-admin',
  'governance-officer',
  'security-reviewer',
  'business-owner',
  'auditor',
  'admin',
  'guest',
]

const ROLE_VARIANT = {
  'platform-admin':     'danger',
  'admin':              'danger',
  'governance-officer': 'warning',
  'security-reviewer':  'info',
  'business-owner':     'info',
  'auditor':            'default',
  'guest':              'default',
}

function RoleBadge({ role }) {
  return <Badge variant={ROLE_VARIANT[role] ?? 'default'}>{role}</Badge>
}

function RoleEditor({ userId, currentRoles, onClose }) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState(currentRoles)
  const toggle = role => setSelected(prev =>
    prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
  )

  const setRoles = useMutation({
    mutationFn: () => usersApi.setRoles(userId, selected),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['users'] }); onClose() },
  })

  return (
    <div className="flex flex-col gap-3 py-1">
      <div className="flex flex-wrap gap-1.5">
        {ALL_ROLES.map(role => (
          <button
            key={role}
            type="button"
            onClick={() => toggle(role)}
            className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition-colors ${
              selected.includes(role)
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'bg-white text-gray-500 border-gray-300 hover:border-indigo-400'
            }`}
          >
            {role}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={selected.length === 0 || setRoles.isPending} onClick={() => setRoles.mutate()}>
          {setRoles.isPending ? 'Saving…' : 'Save Roles'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
      {setRoles.error && <p className="text-xs text-red-600">{setRoles.error.message}</p>}
    </div>
  )
}

// Replaces the manual DB-hash-sync that was previously the only way to
// reset a user's password — no current-password check, since the caller
// already holds user:manage (same privilege that lets them disable the
// account outright).
function PasswordResetEditor({ userId, onClose }) {
  const [password, setPassword] = useState('')

  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(userId, password),
    onSuccess:  onClose,
  })

  return (
    <div className="flex flex-col gap-3 py-1 max-w-sm">
      <div>
        <Label htmlFor="reset-password">New Password</Label>
        <PasswordInput
          id="reset-password" autoFocus
          value={password} onChange={e => setPassword(e.target.value)}
          placeholder="At least 8 characters"
        />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={password.length < 8 || reset.isPending} onClick={() => reset.mutate()}>
          {reset.isPending ? 'Resetting…' : 'Reset Password'}
        </Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
      {reset.error && <p className="text-xs text-red-600">{reset.error.message}</p>}
    </div>
  )
}

export function UserManagement() {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const { user: me } = useAuth()
  const [showAdd, setShowAdd] = useState(false)
  const [editingRolesId, setEditingRolesId] = useState(null)
  const [resettingPasswordId, setResettingPasswordId] = useState(null)
  const [addForm, setAddForm] = useState({ username: '', password: '', role: 'auditor' })
  const setField = k => e => setAddForm(f => ({ ...f, [k]: e.target.value }))

  const { data: userList = [], isLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  usersApi.list,
  })

  const create = useMutation({
    mutationFn: usersApi.create,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      setShowAdd(false)
      setAddForm({ username: '', password: '', role: 'auditor' })
    },
  })

  const disable = useMutation({
    mutationFn: usersApi.disable,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  const enable = useMutation({
    mutationFn: usersApi.enable,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">User Management</h2>
          <p className="text-sm text-gray-500 mt-0.5">
            Create accounts, assign enterprise roles, and disable inactive users.
            Roles determine which actions a user can perform across the governance platform.
          </p>
        </div>
        <Button onClick={() => setShowAdd(v => !v)}>
          <Plus size={15} />{showAdd ? 'Cancel' : 'Add User'}
        </Button>
      </div>

      {showAdd && (
        <Card>
          <div className="p-4 space-y-4">
            <h3 className="text-sm font-medium text-gray-700">New User</h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label htmlFor="new-username">Username</Label>
                <Input id="new-username" value={addForm.username} onChange={setField('username')} placeholder="username" autoFocus />
              </div>
              <div>
                <Label htmlFor="new-password">Password</Label>
                <PasswordInput id="new-password" value={addForm.password} onChange={setField('password')} placeholder="••••••••" />
              </div>
              <div>
                <Label htmlFor="new-role">Initial Role</Label>
                <Select id="new-role" value={addForm.role} onChange={setField('role')}>
                  {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!addForm.username || !addForm.password || create.isPending}
                onClick={() => create.mutate(addForm)}
              >
                {create.isPending ? 'Creating…' : 'Create User'}
              </Button>
            </div>
            {create.error && <p className="text-sm text-red-600">{create.error.message}</p>}
          </div>
        </Card>
      )}

      <Card>
        <Table>
          <thead><tr>
            <Th>Username</Th>
            <Th>Status</Th>
            <Th>Roles</Th>
            <Th>Last Login</Th>
            <Th>Created</Th>
            <Th />
          </tr></thead>
          <tbody>
            {isLoading && <tr><Td colSpan={6} className="text-center text-gray-400">Loading…</Td></tr>}

            {userList.map(u => (
              <Fragment key={u.id}>
                <Tr>
                  <Td className="font-mono text-xs font-medium text-gray-800">
                    {u.username}
                    {u.username === me?.username && (
                      <span className="ml-1.5 text-gray-400 font-sans font-normal">(you)</span>
                    )}
                  </Td>
                  <Td>
                    <Badge variant={u.status === 'active' ? 'success' : 'default'}>{u.status}</Badge>
                  </Td>
                  <Td>
                    {editingRolesId === u.id
                      ? null
                      : (
                        <div className="flex flex-wrap gap-1">
                          {(u.roles ?? []).map(r => <RoleBadge key={r} role={r} />)}
                          {!u.roles?.length && <span className="text-gray-300 text-xs">—</span>}
                        </div>
                      )}
                  </Td>
                  <Td className="text-xs text-gray-400">
                    {u.last_login_at ? new Date(u.last_login_at).toLocaleString() : '—'}
                  </Td>
                  <Td className="text-xs text-gray-400">
                    {new Date(u.created_at).toLocaleDateString()}
                  </Td>
                  <Td>
                    {u.status === 'active' && (
                      <div className="flex gap-1.5">
                        <button
                          title="Edit roles"
                          onClick={() => { setResettingPasswordId(null); setEditingRolesId(id => id === u.id ? null : u.id) }}
                          className="text-gray-400 hover:text-indigo-600 p-0.5"
                        >
                          <ShieldCheck size={13} />
                        </button>
                        <button
                          title="Reset password"
                          onClick={() => { setEditingRolesId(null); setResettingPasswordId(id => id === u.id ? null : u.id) }}
                          className="text-gray-400 hover:text-indigo-600 p-0.5"
                        >
                          <KeyRound size={13} />
                        </button>
                        {u.username !== me?.username && (
                          <button
                            title="Disable user"
                            onClick={async () => {
                              const ok = await confirm({
                                title:        'Disable User',
                                message:      `Disable "${u.username}"? They will not be able to log in until re-enabled.`,
                                confirmLabel: 'Disable',
                              })
                              if (ok) disable.mutate(u.id)
                            }}
                            className="text-gray-400 hover:text-red-500 p-0.5"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                    {u.status !== 'active' && (
                      <button
                        title="Enable user"
                        onClick={() => enable.mutate(u.id)}
                        className="text-gray-400 hover:text-green-600 p-0.5"
                      >
                        <UserCheck size={13} />
                      </button>
                    )}
                  </Td>
                </Tr>
                {editingRolesId === u.id && (
                  <tr key={`${u.id}-roles`}>
                    <Td colSpan={6} className="bg-gray-50">
                      <RoleEditor
                        userId={u.id}
                        currentRoles={u.roles ?? []}
                        onClose={() => setEditingRolesId(null)}
                      />
                    </Td>
                  </tr>
                )}
                {resettingPasswordId === u.id && (
                  <tr key={`${u.id}-password`}>
                    <Td colSpan={6} className="bg-gray-50">
                      <PasswordResetEditor
                        userId={u.id}
                        onClose={() => setResettingPasswordId(null)}
                      />
                    </Td>
                  </tr>
                )}
              </Fragment>
            ))}

            {!isLoading && userList.length === 0 && (
              <tr><Td colSpan={6} className="text-center text-gray-400 py-8">No users found.</Td></tr>
            )}
          </tbody>
        </Table>
      </Card>

      {dialog}
    </div>
  )
}
