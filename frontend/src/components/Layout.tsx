import type { ReactNode } from 'react'
import { Background } from './Background'
import { useAuth } from '../context/AuthContext'
import { Navbar } from './Navbar'

export function Layout({ children }: { children: ReactNode }) {
  const { error } = useAuth()
  return (
    <div className="relative flex min-h-screen flex-col">
      <Background />
      <Navbar />
      {error && <p role="alert" className="mx-auto max-w-6xl p-4 text-sm text-red-700">{error}</p>}
      <main className="flex-1">{children}</main>
      <footer className="border-t border-navy-100 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-xs text-navy-400 sm:flex-row sm:px-6">
          <p className="font-mono uppercase tracking-[0.14em]">
            AccessPilot — accessibility auditing &amp; remediation
          </p>
          <p>Draft pull requests require human review before merging.</p>
        </div>
      </footer>
    </div>
  )
}
