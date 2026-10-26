import { Github, LayoutDashboard, LogOut } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from './Logo'
import { Spinner } from './Spinner'

function navClass({ isActive }: { isActive: boolean }): string {
  return `inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-semibold transition ${
    isActive
      ? 'border border-[#dfe9f8] bg-white text-[#123b82] shadow-[0_6px_16px_-12px_rgba(16,45,95,0.35)]'
      : 'border border-transparent text-[#405b85] hover:bg-white hover:text-[#123b82]'
  }`
}

export function Navbar() {
  const { status, user, openConnect, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-40 px-3 pt-3 sm:px-5">
      <div className="workspace-nav-bar mx-auto flex h-[64px] w-full max-w-6xl items-center gap-2 px-3 sm:h-[68px] sm:gap-4 sm:px-5">
        <Logo to="/" />

        <nav
          aria-label="Workspace navigation"
          className="ml-auto flex items-center gap-1 sm:ml-6 sm:mr-auto"
        >
          {status === 'authenticated' && (
            <NavLink to="/dashboard" className={navClass} aria-label="Dashboard">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Dashboard</span>
            </NavLink>
          )}
        </nav>

        <div className="flex items-center gap-2 sm:gap-3">
          {status === 'loading' ? (
            <span className="flex items-center gap-2 text-sm text-navy-400">
              <Spinner />
              <span className="hidden sm:inline">Checking session</span>
            </span>
          ) : status === 'authenticated' && user ? (
            <>
              <span className="hidden items-center gap-2.5 sm:flex">
                <span className="text-right leading-tight">
                  <span className="block text-sm font-semibold text-navy-800">{user.login}</span>
                  <span className="block font-mono text-[9px] uppercase tracking-[0.14em] text-navy-400">
                    Workspace
                  </span>
                </span>
                <span className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-navy-800 to-brand-600 text-xs font-bold uppercase text-white shadow-sm">
                  {user.login.slice(0, 2)}
                </span>
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="btn-ghost"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </>
          ) : (
            <button type="button" onClick={openConnect} className="btn-primary">
              <Github className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline">Connect GitHub</span>
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
