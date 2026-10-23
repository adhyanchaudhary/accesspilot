import { ArrowRight, CheckCircle2, Github, GitPullRequest, LockKeyhole, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { Spinner } from './Spinner'
import './ConnectGitHubPanel.css'

export function ConnectGitHubPanel() {
  const { connectOpen, closeConnect, status, user, error, signIn, signOut } = useAuth()
  const dialog = useRef<HTMLDialogElement>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    const element = dialog.current
    if (!connectOpen || !element) return
    const opener = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      if (opener?.isConnected) opener.focus()
    }
  }, [connectOpen])

  return <dialog ref={dialog} className="github-connect-dialog" aria-labelledby="github-connect-title"
    aria-describedby="github-connect-description" onKeyDown={event => {
      if (event.key !== 'Tab') return
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (!first) { event.preventDefault(); return }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
        event.preventDefault(); first.focus()
      }
    }} onCancel={event => { event.preventDefault(); closeConnect() }}
    onClick={event => { if (event.target === event.currentTarget) closeConnect() }}>
    <section className="github-connect-panel" aria-busy={disconnecting}>
      <div className="flex items-center justify-between border-b border-navy-100 px-6 py-5">
        <span className="font-semibold text-navy-900">Access<span className="text-brand-600">Pilot</span></span>
        <button type="button" className="btn-ghost" onClick={closeConnect} aria-label="Close GitHub connection panel" autoFocus>
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-8 sm:px-8">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-navy-950 text-white">
          <Github className="h-7 w-7" aria-hidden="true" />
        </div>
        <div>
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-brand-600">Your first accessibility scan</p>
          <h2 id="github-connect-title" className="text-3xl font-bold tracking-tight text-navy-950">Connect your GitHub</h2>
          <p id="github-connect-description" className="mt-3 text-sm leading-relaxed text-navy-500">
            Choose the repository behind your website and receive proposed accessibility fixes in a draft pull request.
          </p>
        </div>
        <div className="space-y-4 rounded-2xl border border-navy-100 bg-navy-50 p-5 text-sm text-navy-600">
          <p className="flex gap-3"><LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />Only repositories authorized for you and the AccessPilot GitHub App are available.</p>
          <p className="flex gap-3"><GitPullRequest className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" aria-hidden="true" />Fixes go to a separate branch and draft PR. You review them before merging.</p>
        </div>
        {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
        <div aria-live="polite">
          {status === 'loading' ? <p className="flex items-center gap-2 text-sm text-navy-500"><Spinner />Checking your GitHub connection…</p>
            : status === 'authenticated' && user ? <div className="space-y-4">
              <p className="flex items-center gap-2 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-800"><CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />Connected as @{user.login}</p>
              <button type="button" className="btn-primary w-full" disabled={disconnecting} onClick={() => {
                closeConnect(); navigate('/dashboard#new-audit')
              }}>Continue to dashboard<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" disabled={disconnecting} className="btn-secondary w-full" onClick={async () => {
                setDisconnecting(true)
                try { await signOut() } finally { setDisconnecting(false) }
              }}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
              <p className="text-xs leading-relaxed text-navy-400">Disconnect ends this AccessPilot session. It does not uninstall the GitHub App or revoke its GitHub authorization.</p>
            </div> : <div className="space-y-4">
              <button type="button" className="btn-primary w-full" onClick={signIn}><Github className="h-5 w-5" aria-hidden="true" />Connect my GitHub<ArrowRight className="h-4 w-4" aria-hidden="true" /></button>
              <p className="text-xs leading-relaxed text-navy-400">You’ll continue on GitHub to sign in and authorize AccessPilot, then return to your dashboard. No scan starts until you select a repository and submit its website URL.</p>
            </div>}
        </div>
      </div>
      <div className="border-t border-navy-100 px-6 py-5 text-xs text-navy-400">Your GitHub password is entered only on github.com.</div>
    </section>
  </dialog>
}
