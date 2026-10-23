import { Github, LayoutDashboard, LogOut } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Logo } from './Logo'
import { Spinner } from './Spinner'

function navClass({ isActive }: { isActive: boolean }): string {
  return `inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-navy-600 hover:bg-navy-100/70 hover:text-navy-900'
  }`
}

export function Navbar() {
  const { status, user, openConnect, signOut } = useAuth()

  return (
    <header className="sticky top-0 z-30 border-b border-navy-100/80 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo to="/" />
          <span className="hidden flex-col gap-1 border-l border-navy-200 pl-3 lg:flex">
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-navy-400">
              A11Y Engine · v1.0
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-brand-700">
              <i className="h-1.5 w-1.5 rounded-full bg-brand-500 animate-pulse-dot" />
              WCAG 2.2 AA
            </span>
          </span>
        </div>

        <nav aria-label="Workspace navigation" className="flex items-center gap-1">
          {status === 'authenticated' && (
            <NavLink to="/dashboard" className={navClass} aria-label="Dashboard">
              <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
              <span>Dashboard</span>
            </NavLink>
          )}
        </nav>

        <div className="flex items-center gap-3">
          {status === 'loading' ? (
            <span className="flex items-center gap-2 text-sm text-navy-400">
              <Spinner />
              Checking session
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
              Connect GitHub
            </button>
          )}
        </div>
      </div>
    </header>
  )
}
