import { NavLink, Outlet } from 'react-router-dom'

const tabs = [
  { to: '/', label: 'Overview', end: true },
  { to: '/videos', label: 'Videos', end: false },
  { to: '/today', label: 'Today', end: false },
]

function App() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">Factory Monitor</div>
          <nav className="tabs" aria-label="Primary navigation">
            {tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  isActive ? 'tab-link tab-link-active' : 'tab-link'
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </nav>
          <a className="ai-board-link" href="../ai/">
            AI Board {'->'}
          </a>
        </div>
      </header>
      <main className="page-wrap">
        <Outlet />
      </main>
    </div>
  )
}

export default App
