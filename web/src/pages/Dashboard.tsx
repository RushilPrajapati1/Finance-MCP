import { Link } from 'react-router-dom'
import { api } from '../api/client'
import type { Account, Balance } from '../api/types'
import { Badge, ErrorBanner, Spinner, Stat } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { addDecimal, compareDecimal, formatMoney, subtractDecimal } from '../lib/money'

interface PortfolioData {
  accounts: Account[]
  balances: Balance[]
  trial: Awaited<ReturnType<typeof api.trialBalance>>
  integrity: Awaited<ReturnType<typeof api.verify>>
}

async function loadPortfolio(): Promise<PortfolioData> {
  const accounts = await api.listAccounts()
  const [balances, trial, integrity] = await Promise.all([
    Promise.all(accounts.map((a) => api.getBalance(a.id))),
    api.trialBalance(),
    api.verify(),
  ])
  return { accounts, balances, trial, integrity }
}

// One row per currency: assets / liabilities / equity and the net worth.
interface CurrencyRow {
  currency: string
  assets: string
  liabilities: string
  revenue: string
  expense: string
}

function rollup(accounts: Account[], balances: Balance[]): CurrencyRow[] {
  const byId = new Map(balances.map((b) => [b.account_id, b]))
  const rows = new Map<string, CurrencyRow>()
  for (const acct of accounts) {
    const bal = byId.get(acct.id)
    if (!bal) continue
    const row =
      rows.get(acct.currency) ??
      {
        currency: acct.currency,
        assets: '0',
        liabilities: '0',
        revenue: '0',
        expense: '0',
      }
    if (acct.type === 'asset') row.assets = addDecimal(row.assets, bal.balance)
    else if (acct.type === 'liability')
      row.liabilities = addDecimal(row.liabilities, bal.balance)
    else if (acct.type === 'revenue') row.revenue = addDecimal(row.revenue, bal.balance)
    else if (acct.type === 'expense') row.expense = addDecimal(row.expense, bal.balance)
    rows.set(acct.currency, row)
  }
  return [...rows.values()].sort((a, b) => a.currency.localeCompare(b.currency))
}

function Signed({ amount, currency }: { amount: string; currency: string }) {
  const sign = compareDecimal(amount, '0')
  return (
    <span className={sign < 0 ? 'neg' : sign > 0 ? 'pos' : ''}>
      {formatMoney(amount, currency)}
    </span>
  )
}

export default function Dashboard() {
  const { data, loading, error, reload } = useAsync(loadPortfolio, [])

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Portfolio</h1>
          <p>Net worth and performance, rolled up from the ledger.</p>
        </div>
        <button className="btn ghost sm" onClick={reload}>
          Refresh
        </button>
      </div>

      <ErrorBanner message={error} />
      {loading && <Spinner />}

      {data && !loading && (
        <PortfolioView data={data} />
      )}
    </>
  )
}

function PortfolioView({ data }: { data: PortfolioData }) {
  const { accounts, balances, trial, integrity } = data
  const rows = rollup(accounts, balances)

  if (accounts.length === 0) {
    return (
      <div className="card">
        <p className="muted">
          No accounts yet. Head to the{' '}
          <Link to="/simulator">Simulator</Link> to seed a demo portfolio, or
          create accounts under <Link to="/accounts">Accounts</Link>.
        </p>
      </div>
    )
  }

  const currencyCount = rows.length

  return (
    <>
      <div className="stat-grid">
        <Stat title="Accounts" value={accounts.length} sub={`${currencyCount} currencies`} />
        <Stat
          title="Ledger Integrity"
          value={
            <Badge kind={integrity.consistent ? 'ok' : 'bad'}>
              {integrity.consistent ? 'Consistent' : 'Drift detected'}
            </Badge>
          }
          sub="Balances vs. posting history"
        />
        <Stat
          title="Trial Balance"
          value={
            <Badge kind={trial.balanced ? 'ok' : 'bad'}>
              {trial.balanced ? 'Balanced' : 'Unbalanced'}
            </Badge>
          }
          sub={`${trial.currencies.length} currency totals`}
        />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="card-title">Net Worth by Currency</div>
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              <th className="num">Assets</th>
              <th className="num">Liabilities</th>
              <th className="num">Net Worth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const net = subtractDecimal(r.assets, r.liabilities)
              return (
                <tr key={r.currency}>
                  <td><strong>{r.currency}</strong></td>
                  <td className="num">{formatMoney(r.assets, r.currency)}</td>
                  <td className="num">{formatMoney(r.liabilities, r.currency)}</td>
                  <td className="num"><Signed amount={net} currency={r.currency} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-title">Income &amp; Expense (P&amp;L)</div>
        <table>
          <thead>
            <tr>
              <th>Currency</th>
              <th className="num">Revenue</th>
              <th className="num">Expenses</th>
              <th className="num">Net Income</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const net = subtractDecimal(r.revenue, r.expense)
              return (
                <tr key={r.currency}>
                  <td><strong>{r.currency}</strong></td>
                  <td className="num">{formatMoney(r.revenue, r.currency)}</td>
                  <td className="num">{formatMoney(r.expense, r.currency)}</td>
                  <td className="num"><Signed amount={net} currency={r.currency} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
