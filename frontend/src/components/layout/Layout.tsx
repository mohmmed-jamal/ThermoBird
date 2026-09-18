import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, FlaskConical, Workflow, LogOut } from 'lucide-react'
import Logo from '../ui/Logo'

const nav = [
  { to: '/dashboard',  label: 'Dashboard',      icon: LayoutDashboard },
  { to: '/properties', label: 'Properties',     icon: FlaskConical },
  { to: '/cycle',      label: 'Cycle Analyzer', icon: Workflow },
]

export default function Layout() {
  const navigate = useNavigate()

  return (
    <div className="flex h-screen overflow-hidden">

      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col tb-sidebar border-r">

        {/* Logo */}
        <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--tb-border)' }}>
          <NavLink to="/" className="block no-underline">
            <Logo size={22} wordmarkClassName="text-xl" className="text-xl" />
            <p className="text-xs mt-0.5" style={{ color: 'var(--tb-text-muted)' }}>
              Thermodynamic Platform
            </p>
          </NavLink>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} className="tb-nav-link">
              <Icon size={17} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4" style={{ borderTop: '1px solid var(--tb-border)' }}>
          <button
            onClick={() => { /* no-op logout in public mode */ navigate('/'); }}
            className="tb-btn-danger w-full justify-start"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto" style={{ background: 'var(--tb-bg-base)' }}>
        <Outlet />
      </main>
    </div>
  )
}
