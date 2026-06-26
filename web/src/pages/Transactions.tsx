import { useMemo, useState } from 'react'
import { api, ApiError, newIdempotencyKey } from '../api/client'
import type { Account, Direction, Transaction } from '../api/types'
import { Badge, EmptyState, ErrorBanner, Modal, Spinner } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import {
  addDecimal,
  compareDecimal,
  formatMoney,
  isValidPositiveAmount,
} from '../lib/money'

async function loadData() {
  const [transactions, accounts] = await Promise.all([
    api.listTransactions(100),
    api.listAccounts(),
  ])
  return { transactions, accounts }
}

export default function Transactions() {
  const { data, loading, error, reload } = useAsync(loadData, [])
  const [composing, setComposing] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const accountName = useMemo(() => {
    const map = new Map<string, Account>()
    data?.accounts.forEach((a) => map.set(a.id, a))
    return map
  }, [data])

  // Original transactions that already have a reversal pointing at them.
  const reversedIds = useMemo(() => {
    const s = new Set<string>()
    data?.transactions.forEach((t) => {
      if (t.reverses_transaction_id) s.add(t.reverses_transaction_id)
    })
    return s
  }, [data])

  async function reverse(t: Transaction) {
    if (!confirm('Post a reversing transaction to undo this entry?')) return
    setActionError(null)
    try {
      await api.reverseTransaction(t.id, {
        description: `Reversal of ${t.description ?? t.id.slice(0, 8)}`,
        idempotency_key: newIdempotencyKey(),
      })
      reload()
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : String(err))
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Transactions</h1>
          <p>Immutable journal entries. Undo by posting a reversal.</p>
        </div>
        <button
          className="btn"
          onClick={() => setComposing(true)}
          disabled={!data || data.accounts.length < 2}
          title={
            data && data.accounts.length < 2
              ? 'Create at least two accounts first'
              : undefined
          }
        >
          + New transaction
        </button>
      </div>

      <ErrorBanner message={error ?? actionError} />
      {loading && <Spinner />}

      {data && !loading && (
        <div className="card" style={{ padding: 0 }}>
          {data.transactions.length === 0 ? (
            <EmptyState>No transactions yet.</EmptyState>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Description</th>
                  <th>Postings</th>
                  <th></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="faint" style={{ whiteSpace: 'nowrap' }}>
                      {new Date(t.created_at).toLocaleDateString()}
                      <div className="mono" style={{ fontSize: 11 }}>
                        {new Date(t.created_at).toLocaleTimeString()}
                      </div>
                    </td>
                    <td>
                      {t.description ?? <span className="faint">—</span>}
                      {t.reverses_transaction_id && (
                        <>
                          {' '}
                          <Badge kind="muted">reversal</Badge>
                        </>
                      )}
                      {reversedIds.has(t.id) && (
                        <>
                          {' '}
                          <Badge kind="muted">reversed</Badge>
                        </>
                      )}
                    </td>
                    <td>
                      {t.postings.map((p) => (
                        <div key={p.id} style={{ fontSize: 12 }}>
                          <Badge kind={p.direction as Direction}>
                            {p.direction === 'debit' ? 'Dr' : 'Cr'}
                          </Badge>{' '}
                          {accountName.get(p.account_id)?.name ??
                            p.account_id.slice(0, 8)}{' '}
                          <span className="mono">
                            {formatMoney(p.amount, p.currency)}
                          </span>
                        </div>
                      ))}
                    </td>
                    <td className="faint mono" style={{ fontSize: 11 }}>
                      {t.id.slice(0, 8)}
                    </td>
                    <td>
                      {!t.reverses_transaction_id && !reversedIds.has(t.id) && (
                        <button className="btn danger sm" onClick={() => reverse(t)}>
                          Reverse
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {composing && data && (
        <ComposeModal
          accounts={data.accounts}
          onClose={() => setComposing(false)}
          onPosted={() => {
            setComposing(false)
            reload()
          }}
        />
      )}
    </>
  )
}

interface DraftPosting {
  account_id: string
  direction: Direction
  amount: string
}

function ComposeModal({
  accounts,
  onClose,
  onPosted,
}: {
  accounts: Account[]
  onClose: () => void
  onPosted: () => void
}) {
  const active = accounts.filter((a) => a.is_active)
  const [description, setDescription] = useState('')
  const [postings, setPostings] = useState<DraftPosting[]>([
    { account_id: active[0]?.id ?? '', direction: 'debit', amount: '' },
    { account_id: active[1]?.id ?? active[0]?.id ?? '', direction: 'credit', amount: '' },
  ])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const acctById = useMemo(() => {
    const m = new Map<string, Account>()
    accounts.forEach((a) => m.set(a.id, a))
    return m
  }, [accounts])

  function update(i: number, patch: Partial<DraftPosting>) {
    setPostings((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }
  function addRow() {
    setPostings((rows) => [
      ...rows,
      { account_id: active[0]?.id ?? '', direction: 'debit', amount: '' },
    ])
  }
  function removeRow(i: number) {
    setPostings((rows) => (rows.length > 2 ? rows.filter((_, idx) => idx !== i) : rows))
  }

  // Per-currency debit/credit totals for the live balance check.
  const totals = useMemo(() => {
    const map = new Map<string, { debit: string; credit: string }>()
    for (const p of postings) {
      const cur = acctById.get(p.account_id)?.currency
      if (!cur || !isValidPositiveAmount(p.amount)) continue
      const entry = map.get(cur) ?? { debit: '0', credit: '0' }
      if (p.direction === 'debit') entry.debit = addDecimal(entry.debit, p.amount)
      else entry.credit = addDecimal(entry.credit, p.amount)
      map.set(cur, entry)
    }
    return map
  }, [postings, acctById])

  const balanced =
    totals.size > 0 &&
    [...totals.values()].every((t) => compareDecimal(t.debit, t.credit) === 0)
  const allValid = postings.every(
    (p) => p.account_id && isValidPositiveAmount(p.amount),
  )
  const canPost = balanced && allValid && postings.length >= 2

  async function submit() {
    setSaving(true)
    setError(null)
    try {
      await api.createTransaction({
        description: description.trim() || null,
        idempotency_key: newIdempotencyKey(),
        postings: postings.map((p) => ({
          account_id: p.account_id,
          direction: p.direction,
          amount: p.amount,
        })),
      })
      onPosted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <Modal title="New transaction" onClose={onClose}>
      <ErrorBanner message={error} />
      <div className="field">
        <label>Description</label>
        <input
          value={description}
          autoFocus
          placeholder="e.g. Salary deposit"
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <label>Postings</label>
      {postings.map((p, i) => {
        const cur = acctById.get(p.account_id)?.currency ?? ''
        return (
          <div className="posting-row" key={i}>
            <select
              value={p.account_id}
              onChange={(e) => update(i, { account_id: e.target.value })}
            >
              {active.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.currency})
                </option>
              ))}
            </select>
            <select
              value={p.direction}
              onChange={(e) => update(i, { direction: e.target.value as Direction })}
            >
              <option value="debit">Debit</option>
              <option value="credit">Credit</option>
            </select>
            <input
              inputMode="decimal"
              placeholder={`0.00 ${cur}`}
              value={p.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
            />
            <button
              className="btn ghost sm"
              onClick={() => removeRow(i)}
              disabled={postings.length <= 2}
              title="Remove posting"
            >
              ✕
            </button>
          </div>
        )
      })}
      <button className="btn ghost sm" onClick={addRow} style={{ marginTop: 4 }}>
        + Add posting
      </button>

      <div style={{ marginTop: 16 }}>
        {[...totals.entries()].map(([cur, t]) => {
          const ok = compareDecimal(t.debit, t.credit) === 0
          return (
            <div
              key={cur}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 12,
                padding: '3px 0',
              }}
            >
              <span className="mono">{cur}</span>
              <span className="mono">
                Dr {formatMoney(t.debit, cur)} · Cr {formatMoney(t.credit, cur)}{' '}
                <Badge kind={ok ? 'ok' : 'bad'}>{ok ? 'balanced' : 'off'}</Badge>
              </span>
            </div>
          )
        })}
        {totals.size === 0 && (
          <p className="faint" style={{ fontSize: 12 }}>
            Enter amounts to see the balance check. Debits must equal credits per
            currency.
          </p>
        )}
      </div>

      <div className="toolbar" style={{ marginBottom: 0, marginTop: 12 }}>
        <div className="spacer" />
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn" onClick={submit} disabled={!canPost || saving}>
          {saving ? 'Posting…' : 'Post transaction'}
        </button>
      </div>
    </Modal>
  )
}
