import { NavLink, Outlet } from 'react-router-dom'

const NAV = [
  { to: '/', label: 'Portfolio', end: true, icon: '◎' },
  { to: '/accounts', label: 'Accounts', icon: '▤' },
  { to: '/transactions', label: 'Transactions', icon: '⇄' },
  { to: '/simulator', label: 'Simulator', icon: '✦' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
]

export default function Layout() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="dot" />
          FinLedger
        </div>
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `nav-link${isActive ? ' active' : ''}`
            }
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <div className="sidebar-foot">
          Portfolio simulator
          <br />
          on a double-entry ledger.
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}
