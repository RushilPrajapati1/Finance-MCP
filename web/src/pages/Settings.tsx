import { useState } from 'react'
import { api } from '../api/client'
import { Badge, ErrorBanner } from '../components/ui'
import { useConfig } from '../context/ConfigContext'
import { useAsync } from '../hooks/useAsync'

export default function Settings() {
  const { apiKey, setApiKey } = useConfig()
  const health = useAsync(() => api.health(), [])
  const [newKey, setNewKey] = useState('')
  const [saved, setSaved] = useState(false)

  function rotate() {
    if (!newKey.trim()) return
    setApiKey(newKey.trim())
    setNewKey('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  function disconnect() {
    if (confirm('Forget the API key and return to the connect screen?')) {
      setApiKey('')
    }
  }

  const masked = apiKey.length > 8 ? `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}` : '••••'

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Settings</h1>
          <p>Connection and credentials for this browser.</p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">Backend</div>
        {health.loading && <span className="muted">Checking…</span>}
        {health.error && (
          <div>
            <Badge kind="bad">Unreachable</Badge>{' '}
            <span className="faint">{health.error}</span>
          </div>
        )}
        {health.data && (
          <div>
            <Badge kind="ok">{health.data.status}</Badge>{' '}
            <span className="muted">
              {health.data.service} · {health.data.environment}
            </span>
          </div>
        )}
        <p className="faint" style={{ fontSize: 12, marginBottom: 0 }}>
          Requests proxy through Vite to <code>localhost:8000</code>. Change the
          target with the <code>FINLEDGER_API_URL</code> env var when starting{' '}
          <code>npm run dev</code>.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-title">API key</div>
        <p className="muted" style={{ marginTop: 0 }}>
          Current key: <span className="mono">{masked}</span>
        </p>
        {saved && <div className="banner ok">API key updated.</div>}
        <div className="field">
          <label>Replace key</label>
          <input
            type="password"
            placeholder="flk_…"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
          />
        </div>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <button className="btn" onClick={rotate} disabled={!newKey.trim()}>
            Save key
          </button>
          <div className="spacer" />
          <button className="btn danger" onClick={disconnect}>
            Disconnect
          </button>
        </div>
      </div>

      <ErrorBanner message={null} />
    </>
  )
}
