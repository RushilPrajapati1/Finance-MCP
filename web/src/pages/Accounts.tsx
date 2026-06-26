import { useState } from 'react'
import { api, ApiError } from '../api/client'
import type { AccountCreate, AccountType, Balance } from '../api/types'
import { Badge, EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { ACCOUNT_TYPES, CURRENCY_CODES, formatMoney } from '../lib/money'

async function loadAccounts() {
  const accounts = await api.listAccounts()
  const balances = await Promise.all(accounts.map((a) => api.getBalance(a.id)))
  const byId = new Map<string, Balance>(balances.map((b) => [b.account_id, b]))
  return { accounts, byId }
}

export default function Accounts() {
  const { data, loading, error, reload } = useAsync(loadAccounts, [])
  const [creating, setCreating] = useState(false)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Accounts</h1>
          <p>Your chart of accounts and current balances.</p>
        </div>
        <button className="btn" onClick={() => setCreating(true)}>
          + New account
        </button>
      </div>

      <ErrorBanner message={error} />
      {loading && <Spinner />}

      {data && !loading && (
        <div className="card" style={{ padding: 0 }}>
          {data.accounts.length === 0 ? (
            <EmptyState>No accounts yet. Create one to get started.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Currency</th>
                  <th className="num">Balance</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.accounts.map((a) => {
                  const bal = data.byId.get(a.id)
                  return (
                    <tr key={a.id}>
                      <td>
                        <strong>{a.name}</strong>
                        {!a.is_active && (
                          <>
                            {' '}
                            <Badge kind="muted">inactive</Badge>
                          </>
                        )}
                        {a.external_id && (
                          <div className="faint mono" style={{ fontSize: 11 }}>
                            {a.external_id}
                          </div>
                        )}
                      </td>
                      <td>
                        <Badge kind={a.type}>{a.type}</Badge>
                      </td>
                      <td className="mono">{a.currency}</td>
                      <td className="num">
                        {bal ? formatMoney(bal.balance, a.currency) : '—'}
                      </td>
                      <td className="faint mono" style={{ fontSize: 11 }}>
                        {a.id.slice(0, 8)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {creating && (
        <CreateAccountModal
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            reload()
          }}
        />
      )}
    </>
  )
}

function CreateAccountModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [type, setType] = useState<AccountType>('asset')
  const [currency, setCurrency] = useState('USD')
  const [externalId, setExternalId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim()) {
      setError('Name is required.')
      return
    }
    setSaving(true)
    setError(null)
    const body: AccountCreate = {
      name: name.trim(),
      type,
      currency,
      external_id: externalId.trim() || null,
    }
    try {
      await api.createAccount(body)
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Modal title="New account" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="field">
        <label>Name</label>
        <input
          value={name}
          autoFocus
          placeholder="e.g. Cash · Checking"
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="row">
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value as AccountType)}>
            {ACCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label>External ID (optional)</label>
        <input
          value={externalId}
          placeholder="your own reference"
          onChange={(e) => setExternalId(e.target.value)}
        />
      </div>
      <div className="toolbar" style={{ marginBottom: 0, marginTop: 8 }}>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={saving}>
          {saving ? 'Creating…' : 'Create account'}
        </button>
      </div>
    </Modal>
  )
}
