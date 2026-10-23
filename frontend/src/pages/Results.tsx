import {
  ArrowLeft,
  Copy,
  ExternalLink,
  FileSearch,
  Github,
  GitPullRequest,
  Globe,
  History,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Alert } from '../components/Alert'
import { ChangesViewer } from '../components/ChangesViewer'
import { Corners } from '../components/Corners'
import { EmptyState } from '../components/EmptyState'
import { Layout } from '../components/Layout'
import { PageLoader } from '../components/PageLoader'
import { RemediationPanel } from '../components/RemediationPanel'
import { ScanIndicator } from '../components/ScanIndicator'
import { StatusBadge } from '../components/StatusBadge'
import { StatusStepper } from '../components/StatusStepper'
import { ViolationSummary } from '../components/ViolationSummary'
import { useAuth } from '../context/AuthContext'
import { api, isApiError } from '../lib/api'
import { describeAuditError } from '../lib/errors'
import { statusMeta } from '../lib/status'
import type { AuditJob } from '../lib/types'

const ACTIVE_INTERVAL = 2500
const REMEDIATION_INTERVAL = 8000

export function nextDelay(job: AuditJob): number | null {
  if (job.remediation?.status === 'failed' || job.remediation?.status === 'completed') return null
  if (statusMeta(job.status).active) return ACTIVE_INTERVAL
  // `submitted` does not mean remediation finished. Keep watching at a slower
  // cadence until the backend reports a pull request, without inventing one.
  if (job.status === 'submitted' && !job.remediation?.pr_url) return REMEDIATION_INTERVAL
  return null
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-navy-500 hover:bg-navy-100/70 hover:text-brand-700"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          },
          () => undefined,
        )
      }}
    >
      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function Results() {
  const { jobId = '' } = useParams()
  const { expireSession } = useAuth()

  const [job, setJob] = useState<AuditJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { state } = useLocation()
  const meta = state?.jobId === jobId ? state as { websiteUrl: string; repoFullName: string } : null
  const [reloadKey, setReloadKey] = useState(0)

  const failuresRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const schedule = useCallback((jobState: AuditJob) => {
    const delay = nextDelay(jobState)
    if (delay === null) return
    timerRef.current = setTimeout(() => setReloadKey((key) => key + 1), delay)
  }, [])

  useEffect(() => {
    if (!jobId) {
      setNotFound(true)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    let cancelled = false

    async function poll() {
      try {
        const data = await api.getAudit(jobId, controller.signal)
        if (cancelled) return
        failuresRef.current = 0
        setJob(data)
        setError(null)
        setLoading(false)
        schedule(data)
      } catch (cause) {
        if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) {
          return
        }
        if (isApiError(cause) && cause.isSessionExpired) {
          expireSession()
          return
        }
        if (isApiError(cause) && cause.status === 404) {
          setNotFound(true)
          setLoading(false)
          return
        }
        failuresRef.current += 1
        const message = isApiError(cause)
          ? cause.message
          : 'Unable to reach the backend while checking this audit.'
        if (failuresRef.current >= 3) {
          setError(message)
          setLoading(false)
        } else {
          setError(message)
          timerRef.current = setTimeout(() => setReloadKey((key) => key + 1), ACTIVE_INTERVAL)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      controller.abort()
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [jobId, expireSession, schedule, reloadKey])

  return (
    <Layout>
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-navy-500 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to dashboard
        </Link>

        <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
                Audit results
              </h1>
              {job && <StatusBadge status={job.status} />}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="font-mono text-xs text-navy-500">{jobId}</span>
              {jobId && <CopyButton value={jobId} />}
            </div>
          </div>
          <button
            type="button"
            className="btn-secondary self-start"
            onClick={() => setReloadKey((key) => key + 1)}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>

        {meta && (meta.websiteUrl || meta.repoFullName) && (
          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-brand-100 bg-white/70 px-4 py-3 font-mono text-xs text-navy-500 backdrop-blur">
            {meta.websiteUrl && (
              <a
                href={meta.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 hover:text-brand-700"
              >
                <Globe className="h-4 w-4" aria-hidden="true" />
                {meta.websiteUrl}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            )}
            {meta.repoFullName && (
              <span className="inline-flex items-center gap-1.5">
                <Github className="h-4 w-4" aria-hidden="true" />
                {meta.repoFullName}
              </span>
            )}
          </div>
        )}

        <div className="mt-8">
          {loading && !job ? (
            <PageLoader label="Loading audit status" />
          ) : notFound ? (
            <EmptyState
              icon={FileSearch}
              title="Audit not found"
              description="This audit is unavailable. It may have expired, or it belongs to a different session."
              action={
                <Link to="/dashboard" className="btn-primary">
                  Start a new audit
                </Link>
              }
            />
          ) : (
            <div className="space-y-6">
              {job && (
                <div className="card overflow-hidden">
                  <Corners />
                  <div className="border-b border-navy-100 px-6 py-5">
                    <StatusStepper status={job.status} />
                  </div>
                </div>
              )}

              {job && <ChangesViewer key={job.job_id} job={job} />}

              <div className="grid gap-6 lg:grid-cols-3">
                <div className="min-w-0 space-y-6 lg:col-span-2">
                  {job?.status === 'failed' && (
                    <Alert variant="error" title={describeAuditError(job.error).title}>
                      <p>{describeAuditError(job.error).body}</p>
                      {job.error && (
                        <p className="mt-1">
                          Code:{' '}
                          <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-xs">
                            {job.error}
                          </code>
                        </p>
                      )}
                    </Alert>
                  )}

                  {error && job?.status !== 'failed' && (
                    <Alert variant="warning" title="Live updates paused">
                      {error}
                    </Alert>
                  )}

                  {job && <ViolationSummary summary={job.summary} status={job.status} />}
                  {job?.audit && <div className="card space-y-4 p-5">
                    <h2 className="text-sm font-bold">Detected accessibility issues</h2>
                    {job.audit.violations.length === 0 && <p>No axe violations detected on the scanned page. Manual checks may still be needed.</p>}
                    {job.audit.violations.map(v => <details key={v.id}>
                      <summary className="cursor-pointer font-semibold">{v.id} — {v.impact ?? 'Unspecified impact'}</summary>
                      <p className="my-2 text-sm">{v.description}</p>
                      {v.nodes.map((n, i) => <div key={i} className="my-3 overflow-auto text-xs">
                        <pre className="whitespace-pre-wrap break-all">{JSON.stringify(n.target)}</pre>
                        <pre className="whitespace-pre-wrap break-all">{n.html}</pre>
                        {n.failureSummary && <p>{n.failureSummary}</p>}
                      </div>)}
                    </details>)}
                  </div>}

                  {job && (
                    <RemediationPanel remediation={job.remediation} status={job.status} />
                  )}
                </div>

                <aside className="space-y-6">
                  {job && (
                    <div className="card p-6">
                      <Corners />
                      <h2 className="text-center text-sm font-bold text-navy-900">
                        Audit status
                      </h2>
                      <div className="mt-5">
                        {job.remediation?.status === 'completed' ? <div className="space-y-3 text-center">
                          <GitPullRequest className="mx-auto h-10 w-10 text-emerald-600" aria-hidden="true" />
                          <p className="font-semibold text-navy-900">Draft PR confirmed</p>
                          <p className="text-xs leading-relaxed text-navy-500">Proposed changes are ready for human review. Nothing has been merged or verified by this preview.</p>
                        </div> : <ScanIndicator status={job.status} />}
                      </div>
                    </div>
                  )}

                  {job?.status === 'submitted' && !job.remediation?.pr_url && job.remediation?.status !== 'failed' && (
                    <div className="card p-5">
                      <Corners />
                      <div className="flex items-center gap-2 text-sm font-bold text-navy-900">
                        <History className="h-4 w-4 text-brand-600" aria-hidden="true" />
                        Watching for remediation
                      </div>
                      <p className="mt-2 text-xs leading-relaxed text-navy-500">
                        The audit was accepted by the workflow. AccessPilot will show the draft
                        pull request here as soon as the backend reports it. This is not the same
                        as remediation being complete.
                      </p>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
