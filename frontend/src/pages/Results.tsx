import {
  Activity,
  ArrowLeft,
  Copy,
  ExternalLink,
  FileSearch,
  Github,
  Globe,
  RefreshCw,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { Alert } from '../components/Alert'
import { AuditLoadingScreen } from '../components/AuditLoadingScreen'
import { AuditStatusSummary } from '../components/AuditStatusSummary'
import { ChangesViewer } from '../components/ChangesViewer'
import { EmptyState } from '../components/EmptyState'
import { Layout } from '../components/Layout'
import { RemediationPanel } from '../components/RemediationPanel'
import { StatusBadge } from '../components/StatusBadge'
import { StatusStepper } from '../components/StatusStepper'
import { ViolationList } from '../components/ViolationList'
import { ViolationSummary } from '../components/ViolationSummary'
import { useAuth } from '../context/AuthContext'
import { api, isApiError } from '../lib/api'
import { describeAuditError } from '../lib/errors'
import { statusMeta } from '../lib/status'
import type { AuditJob } from '../lib/types'

const ACTIVE_INTERVAL = 2500
const REMEDIATION_INTERVAL = 8000

export function nextDelay(job: AuditJob): number | null {
  if (job.status === 'completed' || job.remediation?.status === 'no_changes') return null
  if (job.remediation?.status === 'failed' || job.remediation?.status === 'completed') return null
  if (statusMeta(job.status).active) return ACTIVE_INTERVAL
  // `submitted` does not mean remediation finished. Keep watching at a slower
  // cadence until the backend reports a pull request, without inventing one.
  if (job.status === 'submitted' && !job.remediation?.pr_url) return REMEDIATION_INTERVAL
  return null
}

function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
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

  const processing = job === null ? loading : statusMeta(job.status).active

  if (processing) {
    return (
      <Layout variant="report">
        <AuditLoadingScreen
          job={job}
          websiteUrl={meta?.websiteUrl}
          repoFullName={meta?.repoFullName}
        />
      </Layout>
    )
  }

  return (
    <Layout variant="report">
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <Link
          to="/dashboard"
          className="group inline-flex items-center gap-1.5 text-sm font-semibold text-navy-500 hover:text-brand-700"
        >
          <ArrowLeft
            className="h-4 w-4 transition-transform group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          Back to dashboard
        </Link>

        <div className="workspace-intro relative mt-4 overflow-hidden rounded-2xl border border-brand-200 p-4 sm:p-5">
          <div
            className="pointer-events-none absolute inset-0 bg-grid-fade opacity-70"
            aria-hidden="true"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <span className="eyebrow">
                <FileSearch className="h-3.5 w-3.5" aria-hidden="true" />
                Audit report
              </span>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
                  Audit results
                </h1>
                {job && <StatusBadge status={job.status} />}
              </div>
              <div className="mt-4 flex min-w-0 flex-wrap items-center gap-2">
                <span className="inline-flex max-w-full items-center gap-2 rounded-xl border border-brand-100 bg-white/75 py-1.5 pl-3 pr-1.5 font-mono text-[11px] text-navy-600 backdrop-blur">
                  <span className="text-[9px] font-bold uppercase tracking-[0.12em] text-navy-400">
                    Job
                  </span>
                  <span className="max-w-[190px] truncate" title={jobId}>
                    {jobId}
                  </span>
                  {jobId && <CopyButton value={jobId} />}
                </span>
                {meta?.websiteUrl && (
                  <a
                    href={meta.websiteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={meta.websiteUrl}
                    className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-brand-100 bg-white/75 px-3 py-1.5 text-[11px] font-medium text-navy-600 backdrop-blur transition hover:border-brand-300 hover:text-brand-700"
                  >
                    <Globe className="h-3.5 w-3.5 shrink-0 text-brand-500" aria-hidden="true" />
                    <span className="max-w-[210px] truncate">{displayHost(meta.websiteUrl)}</span>
                    <ExternalLink className="h-3 w-3 shrink-0 text-navy-400" aria-hidden="true" />
                  </a>
                )}
                {meta?.repoFullName && (
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-brand-100 bg-white/75 px-3 py-1.5 text-[11px] font-medium text-navy-600 backdrop-blur">
                    <Github className="h-3.5 w-3.5 shrink-0 text-navy-500" aria-hidden="true" />
                    <span className="max-w-[230px] truncate" title={meta.repoFullName}>
                      {meta.repoFullName}
                    </span>
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary shrink-0 self-start border-brand-100 bg-white/80 backdrop-blur lg:self-auto"
              onClick={() => setReloadKey((key) => key + 1)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Refresh
            </button>
          </div>
        </div>

        <div className="mt-5">
          {notFound ? (
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
          ) : !job ? (
            <Alert variant="error" title="Could not load this audit">
              {error ?? 'This audit is unavailable.'}{' '}
              <button
                type="button"
                className="font-semibold underline"
                onClick={() => {
                  setLoading(true)
                  setError(null)
                  setReloadKey((key) => key + 1)
                }}
              >
                Try again
              </button>
            </Alert>
          ) : (
            <div className="space-y-4">
              <div className="card overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-100 bg-white/60 px-5 py-4 sm:px-6">
                  <h2 className="flex items-center gap-2 text-sm font-bold text-navy-900">
                    <Activity className="h-4 w-4 text-brand-600" aria-hidden="true" />
                    Audit progress
                  </h2>
                  <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-400">
                    Scan status
                  </span>
                </div>
                <div className="px-5 py-4 sm:px-6">
                  <StatusStepper status={job.status} />
                </div>
              </div>


              {job.status === 'failed' && (
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

              {error && job.status !== 'failed' && (
                <Alert variant="warning" title="Live updates paused">
                  {error}
                </Alert>
              )}

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="min-w-0 sm:col-span-2">
                  <ViolationSummary summary={job.summary} status={job.status} />
                </div>
                <AuditStatusSummary remediation={job.remediation} status={job.status} />
              </div>

              <div className="audit-review-grid">
                <div className="min-w-0 space-y-4">
                  {job.audit && <ViolationList violations={job.audit.violations} />}
                  <RemediationPanel remediation={job.remediation} status={job.status} />
                </div>
                <div className="min-w-0 audit-review-code">
                  <ChangesViewer key={job.job_id} job={job} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}
