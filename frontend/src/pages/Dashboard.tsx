import {
  ArrowRight,
  ArrowUpRight,
  GitBranch,
  Github,
  Globe,
  Lock,
  PlugZap,
  ScanSearch,
  ShieldCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RepositoryPicker } from '../components/RepositoryPicker'
import { Alert } from '../components/Alert'
import { Corners } from '../components/Corners'
import { EmptyState } from '../components/EmptyState'
import { Layout } from '../components/Layout'
import { ScanFlow } from '../components/ScanFlow'
import { Spinner } from '../components/Spinner'
import { useAuth } from '../context/AuthContext'
import { api, isApiError } from '../lib/api'
import type { Repository } from '../lib/types'

type ReposState = 'loading' | 'ready' | 'error'

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function Dashboard() {
  const { csrfToken, expireSession } = useAuth()
  const navigate = useNavigate()
  const { hash } = useLocation()
  useEffect(() => {
    if (hash === '#new-audit') document.getElementById('new-audit')?.scrollIntoView?.({ behavior: 'auto', block: 'start' })
  }, [hash])

  const [repos, setRepos] = useState<Repository[]>([])
  const [reposState, setReposState] = useState<ReposState>('loading')
  const [reposError, setReposError] = useState<string | null>(null)
  const [selectedRepoId, setSelectedRepoId] = useState<number | null>(null)
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const idempotencyRef = useRef<string | null>(null)

  const loadRepositories = useCallback(
    async (signal?: AbortSignal) => {
      setReposState('loading')
      setReposError(null)
      try {
        const list = await api.listRepositories(signal)
        setRepos(list)
        setSelectedRepoId((current) =>
          current !== null && list.some((r) => r.id === current)
            ? current
            : (list[0]?.id ?? null),
        )
        setReposState('ready')
      } catch (cause) {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        if (isApiError(cause) && cause.isSessionExpired) {
          expireSession()
          return
        }
        setReposError(
          isApiError(cause) ? cause.message : 'Unable to load your repositories.',
        )
        setReposState('error')
      }
    },
    [expireSession],
  )

  useEffect(() => {
    const controller = new AbortController()
    void loadRepositories(controller.signal)
    return () => controller.abort()
  }, [loadRepositories])

  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === selectedRepoId) ?? null,
    [repos, selectedRepoId],
  )

  function invalidateIdempotency() {
    idempotencyRef.current = null
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setFormError(null)

    if (!selectedRepo) {
      setFormError('Select a repository to remediate.')
      return
    }
    if (!isValidHttpUrl(websiteUrl.trim())) {
      setFormError('Enter a valid public website URL starting with http:// or https://.')
      return
    }
    if (!csrfToken) {
      setFormError('Your session is missing a CSRF token. Sign in again.')
      return
    }

    if (!idempotencyRef.current) idempotencyRef.current = crypto.randomUUID()
    setSubmitting(true)
    try {
      const result = await api.submitAudit(
        {
          website_url: websiteUrl.trim(),
          installation_id: selectedRepo.installation_id,
          repository_id: selectedRepo.id,
        },
        csrfToken,
        idempotencyRef.current,
      )
      idempotencyRef.current = null
      navigate(`/audits/${result.job_id}`, { state: {
        jobId: result.job_id,
        websiteUrl: websiteUrl.trim(),
        repoFullName: selectedRepo.full_name,
      } })
    } catch (cause) {
      if (isApiError(cause) && cause.isSessionExpired) {
        expireSession()
        return
      }
      // Keep the idempotency key so a retry of the same input is safe.
      setFormError(
        isApiError(cause)
          ? cause.message
          : 'Could not start the audit. Please try again.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="workspace-intro relative mb-8 overflow-hidden rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 via-white to-navy-50 p-6 shadow-card sm:p-8">
          <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-70" aria-hidden="true" />
          <div className="relative">
            <span className="eyebrow">
              <ScanSearch className="h-3.5 w-3.5" aria-hidden="true" />
              New audit
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
              Scan &amp; fix a repository
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-navy-600">
              Choose a repository, enter the URL of its deployed site, and AccessPilot will scan
              it and prepare a draft pull request with fixes.
            </p>
          </div>
        </div>

        <form id="new-audit" onSubmit={handleSubmit} className="card scroll-mt-24 overflow-hidden">
          <Corners />
          <div className="grid gap-6 p-6 sm:p-7 lg:grid-cols-2 lg:gap-8">
            <div className="min-w-0">
              <div className="mb-2 flex min-h-[38px] flex-wrap items-center justify-between gap-2">
                <label htmlFor="repository" className="label mb-0">
                  Repository
                </label>
                <div className="flex items-center gap-3">
                  {reposState === 'ready' && repos.length > 0 && (
                    <button
                      type="button"
                      title="Manage GitHub App access"
                      onClick={() => window.location.assign(api.installUrl())}
                      className="group inline-flex items-center gap-2 rounded-xl border border-brand-200 bg-gradient-to-r from-white to-brand-50 px-3.5 py-2 text-xs font-bold text-brand-700 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:text-brand-800 hover:shadow-md"
                    >
                      <Github className="h-4 w-4" aria-hidden="true" />
                      Manage
                      <ArrowUpRight
                        className="h-3.5 w-3.5 text-brand-500 transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </button>
                  )}
                </div>
              </div>

              {reposState === 'loading' && (
                <div className="skeleton h-11 w-full" aria-busy="true" />
              )}

              {reposState === 'error' && (
                <Alert variant="error" title="Could not load repositories">
                  {reposError}{' '}
                  <button
                    type="button"
                    className="font-semibold underline"
                    onClick={() => void loadRepositories()}
                  >
                    Try again
                  </button>
                </Alert>
              )}

              {reposState === 'ready' && repos.length === 0 && (
                <EmptyState
                  icon={PlugZap}
                  title="No repositories available"
                  description="Install the AccessPilot GitHub App on at least one repository, then return to the dashboard."
                  action={
                    <button
                      type="button"
                      className="btn-primary"
                      onClick={() => window.location.assign(api.installUrl())}
                    >
                      <Github className="h-4 w-4" aria-hidden="true" />
                      Configure GitHub App
                    </button>
                  }
                />
              )}

              {reposState === 'ready' && repos.length > 0 && (
                <div className="space-y-3">
                  <RepositoryPicker repositories={repos} selected={selectedRepo} onSelect={repo => {
                    setSelectedRepoId(repo.id)
                    invalidateIdempotency()
                  }} />
                  {selectedRepo && (
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-navy-500">
                      <span className="inline-flex items-center gap-1.5">
                        <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                        default branch: {selectedRepo.default_branch}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        {selectedRepo.private ? (
                          <>
                            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                            private
                          </>
                        ) : (
                          <>
                            <Globe className="h-3.5 w-3.5" aria-hidden="true" />
                            public
                          </>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="min-w-0">
              <div className="mb-2 flex min-h-[38px] items-center">
                <label htmlFor="website" className="label mb-0">
                  Deployed website URL
                </label>
              </div>
              <div className="relative">
                <Globe
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-500/70"
                  aria-hidden="true"
                />
                <input
                  id="website"
                  type="url"
                  inputMode="url"
                  autoComplete="url"
                  placeholder="https://your-site.netlify.app"
                  value={websiteUrl}
                  onChange={(event) => {
                    setWebsiteUrl(event.target.value)
                    invalidateIdempotency()
                  }}
                  className="input pl-9"
                  required
                />
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-navy-400">
                Must be a public page reachable on port 80 or 443. Login-protected pages and
                WebSocket-heavy pages may not scan reliably.
              </p>
            </div>

            {formError && (
              <div className="lg:col-span-2">
                <Alert variant="error">{formError}</Alert>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-4 border-t border-navy-100 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
            <p className="flex items-start gap-2.5 text-xs leading-relaxed text-navy-500 sm:max-w-md">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden="true" />
              AccessPilot prepares a draft pull request only. Nothing is merged without your review.
            </p>
            <button
              type="submit"
              className="audit-submit group w-full self-end sm:w-auto sm:self-auto"
              disabled={submitting || reposState !== 'ready' || repos.length === 0}
            >
              <span className="audit-submit-icon">
                {submitting ? (
                  <Spinner className="h-5 w-5" />
                ) : (
                  <ScanSearch className="h-5 w-5" aria-hidden="true" />
                )}
              </span>
              <span className="audit-submit-copy">
                <span className="audit-submit-kicker">
                  {submitting ? 'Launching' : 'New audit'}
                </span>
                <span className="audit-submit-label">
                  {submitting ? 'Starting audit…' : 'Scan & Fix'}
                </span>
              </span>
              {!submitting && (
                <ArrowRight className="audit-submit-arrow h-5 w-5" aria-hidden="true" />
              )}
            </button>
          </div>
        </form>

        <div className="mt-6">
          <ScanFlow />
        </div>
      </div>
    </Layout>
  )
}
