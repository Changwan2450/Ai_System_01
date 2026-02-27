import { NavLink, Outlet, createBrowserRouter } from 'react-router-dom'
import Overview from './pages/Overview'
import Today from './pages/Today'
import Videos from './pages/Videos'
import Dashboard from './pages/Dashboard'

const tabs = [
  { to: '/', label: 'Overview', end: true },
  { to: '/today', label: 'Today', end: false },
  { to: '/videos', label: 'Videos', end: false },
  { to: '/dashboard', label: 'Dashboard', end: false },
]

function AppShell() {
  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="app-container topbar-inner">
          <div className="topbar-left">
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
          </div>

          <a className="ai-board-link" href="../ai/">
            AI Board {'->'}
          </a>
        </div>
      </header>

      <main className="app-container page-wrap">
        <Outlet />
      </main>
    </div>
  )
}

export const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <AppShell />,
      children: [
        { index: true, element: <Overview /> },
        { path: 'today', element: <Today /> },
        { path: 'today/:id', element: <Today /> },
        { path: 'videos', element: <Videos /> },
        { path: 'dashboard', element: <Dashboard /> },
      ],
    },
  ],
  {
    basename: '/factory',
  },
)
