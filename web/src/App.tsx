import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useConfig } from './context/ConfigContext'
import Accounts from './pages/Accounts'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Setup from './pages/Setup'
import Simulator from './pages/Simulator'
import Transactions from './pages/Transactions'

export default function App() {
  const { configured } = useConfig()

  // Until an API key is entered, everything funnels to the setup gate.
  if (!configured) return <Setup />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="simulator" element={<Simulator />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
