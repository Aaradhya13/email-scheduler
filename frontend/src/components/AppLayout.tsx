import type { ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import {
  ClockIcon,
  FilterIcon,
  PaperPlaneIcon,
  RefreshIcon,
  SearchIcon,
} from './Icons'

type AppLayoutProps = {
  children: ReactNode
}

export default function AppLayout({ children }: AppLayoutProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="mail-shell">
      <aside className="sidebar">
        <div className="brand">OutB</div>

        <div className="user-card">
          <div className="avatar">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt="" />
            ) : (
              <span>{user?.name?.charAt(0) || 'U'}</span>
            )}
          </div>
          <div className="user-meta">
            <span className="user-name">{user?.name}</span>
            <span className="user-email">{user?.email}</span>
          </div>
        </div>

        <button
          className="compose-button"
          type="button"
          onClick={() => {
            navigate('/compose')
          }}
        >
          Compose
        </button>

        <div className="nav-section-label">CORE</div>
        <nav className="sidebar-nav">
          <NavLink to="/scheduled" className="nav-item">
            <ClockIcon className="nav-icon" />
            <span>Scheduled</span>
          </NavLink>
          <NavLink to="/sent" className="nav-item">
            <PaperPlaneIcon className="nav-icon" />
            <span>Sent</span>
          </NavLink>
        </nav>
        <button className="logout-nav-item" type="button" onClick={handleLogout}>
          <span aria-hidden="true">&gt;</span>
          <span>Logout</span>
        </button>
      </aside>

      <main className="main-pane">
        <div className="toolbar">
          <label className="search-box">
            <SearchIcon className="search-icon" />
            <input type="search" placeholder="Search" />
          </label>
          <button className="icon-button" type="button" aria-label="Filter">
            <FilterIcon />
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Refresh mailbox"
            onClick={() => window.dispatchEvent(new Event('outbox:refresh-mailbox'))}
          >
            <RefreshIcon />
          </button>
        </div>
        {children}
      </main>
    </div>
  )
}
