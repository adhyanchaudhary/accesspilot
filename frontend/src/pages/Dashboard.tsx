import {
  GitBranch,
  Github,
  Globe,
  Lock,
  PlugZap,
  ScanSearch,
  Sparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RepositoryPicker } from '../components/RepositoryPicker'
import { Alert } from '../components/Alert'
import { Corners } from '../components/Corners'
import { EmptyState } from '../components/EmptyState'
import { Layout } from '../components/Layout'
import { ServiceHealth } from '../components/ServiceHealth'
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

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <form id="new-audit" onSubmit={handleSubmit} className="card scroll-mt-24 space-y-6 p-6">
              <Corners />
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label htmlFor="repository" className="label mb-0">
                    Repository
                  </label>
                  <div className="flex items-center gap-3">
                    {reposState === 'ready' && repos.length > 0 && (
                      <button
                        type="button"
                        onClick={() => window.location.assign(api.installUrl())}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-500 hover:text-brand-700"
                      >
                        <Github className="h-3.5 w-3.5" aria-hidden="true" />
                        Manage
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

              <div>
                <label htmlFor="website" className="label">
                  Deployed website URL
                </label>
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
                <p className="mt-1.5 text-xs text-navy-400">
                  Must be a public page reachable on port 80 or 443. Login-protected pages and
                  WebSocket-heavy pages may not scan reliably.
                </p>
              </div>

              {formError && <Alert variant="error">{formError}</Alert>}

              <div className="flex items-center justify-end gap-3">
                <button
                  type="submit"
                  className="btn-primary px-5 py-3 text-base"
                  disabled={submitting || reposState !== 'ready' || repos.length === 0}
                >
                  {submitting ? (
                    <>
                      <Spinner className="h-5 w-5" />
                      Starting audit…
                    </>
                  ) : (
                    <>
                      <ScanSearch className="h-5 w-5" aria-hidden="true" />
                      Scan &amp; Fix
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>

          <aside className="space-y-6">
            <ServiceHealth />

            <div className="card p-5">
              <Corners />
              <h2 className="flex items-center gap-2 text-sm font-bold text-navy-900">
                <Sparkles className="h-4 w-4 text-brand-600" aria-hidden="true" />
                What happens next
              </h2>
              <ol className="mt-3 space-y-3 text-sm text-navy-600">
                <li className="flex gap-2">
                  <span className="font-mono text-xs text-brand-500">1</span>
                  A headless browser renders the page and runs an axe-core audit.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-xs text-brand-500">2</span>
                  Violations and affected elements are summarized.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-xs text-brand-500">3</span>
                  The AI workflow prepares fixes against your source.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-xs text-brand-500">4</span>
                  A draft pull request link appears on the results page.
                </li>
              </ol>
            </div>
          </aside>
        </div>
      </div>
    </Layout>
  )
}
