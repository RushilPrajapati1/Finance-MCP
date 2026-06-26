import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError, newIdempotencyKey } from '../api/client'
import type { AccountType, Direction } from '../api/types'
import { ErrorBanner } from '../components/ui'

// A self-contained demo portfolio. external_id keys make seeding idempotent:
// re-running reuses existing accounts instead of duplicating them.
const DEMO_ACCOUNTS: {
  ext: string
  name: string
  type: AccountType
}[] = [
  { ext: 'demo-cash', name: 'Cash · Checking', type: 'asset' },
  { ext: 'demo-brokerage', name: 'Brokerage', type: 'asset' },
  { ext: 'demo-card', name: 'Credit Card', type: 'liability' },
  { ext: 'demo-equity', name: "Owner's Capital", type: 'equity' },
  { ext: 'demo-salary', name: 'Salary', type: 'revenue' },
  { ext: 'demo-rent', name: 'Rent', type: 'expense' },
  { ext: 'demo-groceries', name: 'Groceries', type: 'expense' },
]

interface Leg {
  ext: string
  direction: Direction
  amount: string
}
interface DemoTx {
  key: string
  description: string
  legs: Leg[]
}

const SEED_TX: DemoTx[] = [
  {
    key: 'demo-tx-open',
    description: 'Opening capital',
    legs: [
      { ext: 'demo-cash', direction: 'debit', amount: '10000.00' },
      { ext: 'demo-equity', direction: 'credit', amount: '10000.00' },
    ],
  },
  {
    key: 'demo-tx-salary',
    description: 'Salary deposit',
    legs: [
      { ext: 'demo-cash', direction: 'debit', amount: '5000.00' },
      { ext: 'demo-salary', direction: 'credit', amount: '5000.00' },
    ],
  },
  {
    key: 'demo-tx-rent',
    description: 'Monthly rent',
    legs: [
      { ext: 'demo-rent', direction: 'debit', amount: '2000.00' },
      { ext: 'demo-cash', direction: 'credit', amount: '2000.00' },
    ],
  },
  {
    key: 'demo-tx-invest',
    description: 'Buy investments',
    legs: [
      { ext: 'demo-brokerage', direction: 'debit', amount: '4000.00' },
      { ext: 'demo-cash', direction: 'credit', amount: '4000.00' },
    ],
  },
  {
    key: 'demo-tx-groceries',
    description: 'Groceries on credit card',
    legs: [
      { ext: 'demo-groceries', direction: 'debit', amount: '350.00' },
      { ext: 'demo-card', direction: 'credit', amount: '350.00' },
    ],
  },
]

// One-tap activity to drive the simulation after seeding.
const QUICK_ACTIONS: { label: string; description: string; legs: Leg[] }[] = [
  {
    label: 'Receive salary (+$5,000)',
    description: 'Salary deposit',
    legs: [
      { ext: 'demo-cash', direction: 'debit', amount: '5000.00' },
      { ext: 'demo-salary', direction: 'credit', amount: '5000.00' },
    ],
  },
  {
    label: 'Pay rent (-$2,000)',
    description: 'Monthly rent',
    legs: [
      { ext: 'demo-rent', direction: 'debit', amount: '2000.00' },
      { ext: 'demo-cash', direction: 'credit', amount: '2000.00' },
    ],
  },
  {
    label: 'Buy $1,000 of investments',
    description: 'Buy investments',
    legs: [
      { ext: 'demo-brokerage', direction: 'debit', amount: '1000.00' },
      { ext: 'demo-cash', direction: 'credit', amount: '1000.00' },
    ],
  },
  {
    label: 'Grocery run on card ($75)',
    description: 'Groceries on credit card',
    legs: [
      { ext: 'demo-groceries', direction: 'debit', amount: '75.00' },
      { ext: 'demo-card', direction: 'credit', amount: '75.00' },
    ],
  },
]

export default function Simulator() {
  const navigate = useNavigate()
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function append(line: string) {
    setLog((l) => [...l, line])
  }

  // Resolve external_id -> account id, creating any missing demo accounts.
  async function ensureAccounts(): Promise<Map<string, string>> {
    const existing = await api.listAccounts()
    const byExt = new Map<string, string>()
    existing.forEach((a) => a.external_id && byExt.set(a.external_id, a.id))

    for (const spec of DEMO_ACCOUNTS) {
      if (byExt.has(spec.ext)) continue
      try {
        const created = await api.createAccount({
          name: spec.name,
          type: spec.type,
          currency: 'USD',
          external_id: spec.ext,
        })
        byExt.set(spec.ext, created.id)
        append(`✓ created account "${spec.name}"`)
      } catch (err) {
        // Lost a race or already exists — fall back to the latest listing.
        if (err instanceof ApiError && err.code === 'duplicate_account') {
          const refreshed = await api.listAccounts()
          refreshed.forEach((a) => a.external_id && byExt.set(a.external_id, a.id))
        } else {
          throw err
        }
      }
    }
    return byExt
  }

  async function post(byExt: Map<string, string>, tx: DemoTx | { description: string; legs: Leg[] }, key: string) {
    await api.createTransaction({
      description: tx.description,
      idempotency_key: key,
      postings: tx.legs.map((leg) => ({
        account_id: byExt.get(leg.ext)!,
        direction: leg.direction,
        amount: leg.amount,
      })),
    })
  }

  async function seed() {
    setBusy(true)
    setError(null)
    setLog([])
    append('Seeding demo portfolio…')
    try {
      const byExt = await ensureAccounts()
      for (const tx of SEED_TX) {
        await post(byExt, tx, tx.key) // stable key => safe to re-run
        append(`✓ posted "${tx.description}"`)
      }
      append('Done. Demo portfolio is ready.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function runAction(action: (typeof QUICK_ACTIONS)[number]) {
    setBusy(true)
    setError(null)
    try {
      const byExt = await ensureAccounts()
      if (action.legs.some((l) => !byExt.get(l.ext))) {
        setError('Seed the demo portfolio first.')
        return
      }
      await post(byExt, action, newIdempotencyKey()) // fresh key => new entry each time
      append(`✓ ${action.label}`)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Simulator</h1>
          <p>Spin up a demo portfolio, then drive it with one-tap activity.</p>
        </div>
      </div>

      <ErrorBanner message={error} />

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">1 · Seed</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Creates a USD chart of accounts (cash, brokerage, credit card, equity,
          salary, rent, groceries) and posts opening balances. Safe to run more
          than once — it reuses existing demo accounts and replays the same
          seed entries.
        </p>
        <button className="btn" onClick={seed} disabled={busy}>
          {busy ? 'Working…' : 'Seed demo portfolio'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">2 · Simulate activity</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Each button posts a fresh balanced transaction against the demo
          accounts.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a.label}
              className="btn ghost"
              onClick={() => runAction(a)}
              disabled={busy}
            >
              {a.label}
            </button>
          ))}
        </div>
        <div className="toolbar" style={{ marginTop: 16, marginBottom: 0 }}>
          <button className="btn sm" onClick={() => navigate('/')}>
            View portfolio →
          </button>
        </div>
      </div>

      {log.length > 0 && (
        <div className="card">
          <div className="card-title">Activity log</div>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12 }}>
            {log.join('\n')}
          </pre>
        </div>
      )}
    </>
  )
}
