import { useState } from 'react'
import { api, ApiError, setApiKey as persistKey } from '../api/client'
import { useConfig } from '../context/ConfigContext'
import { ErrorBanner } from '../components/ui'

export default function Setup() {
  const { setApiKey } = useConfig()
  const [key, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  async function connect() {
    const trimmed = key.trim()
    if (!trimmed) {
      setError('Enter an API key.')
      return
    }
    setChecking(true)
    setError(null)
    // Temporarily set the key so the authed probe call can use it.
    persistKey(trimmed)
    try {
      await api.listAccounts() // 200 => key is valid for a tenant
      setApiKey(trimmed) // commit to context -> unlocks the app
    } catch (err) {
      persistKey('') // roll back the bad key
      if (err instanceof ApiError && err.status === 401) {
        setError('That API key was rejected (401). Check it and try again.')
      } else if (err instanceof ApiError) {
        setError(err.message)
      } else {
        setError(String(err))
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="gate">
      <div className="card">
        <div className="brand" style={{ paddingLeft: 0 }}>
          <span className="dot" />
          FinLedger Portfolio
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Connect to your ledger tenant to begin. Mint a key on the backend with{' '}
          <code>finledger create-tenant "My Company"</code>.
        </p>
        <div className="field">
          <label>API key</label>
          <input
            type="password"
            placeholder="flk_…"
            value={key}
            autoFocus
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && connect()}
          />
        </div>
        <ErrorBanner message={error} />
        <button className="btn" onClick={connect} disabled={checking} style={{ width: '100%' }}>
          {checking ? 'Connecting…' : 'Connect'}
        </button>
        <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
          The key is stored only in this browser (localStorage) and sent as the{' '}
          <code>X-API-Key</code> header. Requests are proxied to{' '}
          <code>localhost:8000</code> via Vite.
        </p>
      </div>
    </div>
  )
}
