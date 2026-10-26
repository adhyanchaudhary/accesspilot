import { Activity, Gauge, Loader2 } from 'lucide-react'
import type { AuditJob, AuditStatus } from '../lib/types'
import { ScanConsole } from './ScanConsole'
import { StatusStepper } from './StatusStepper'
import './ScanPanels.css'

const STAGE_INDEX: Record<AuditStatus, number> = {
  queued: 0,
  scanning: 1,
  dispatching: 2,
  submitted: 3,
  failed: -1,
}

const STAGE_PROGRESS: Record<AuditStatus, number> = {
  queued: 10,
  scanning: 45,
  dispatching: 78,
  submitted: 100,
  failed: 100,
}

const STAGE_LABELS = ['Queued', 'Scanning', 'Dispatching', 'Submitted']

const STAGE_DESCRIPTION: Record<AuditStatus, string> = {
  queued: 'Waiting for a scanner worker to pick up the job.',
  scanning: 'Rendering the page and running accessibility checks.',
  dispatching: 'Grouping findings and handing off to remediation.',
  submitted: 'Handoff complete — preparing the audit results.',
  failed: 'The audit could not be completed.',
}

function hostFrom(url?: string): string {
  if (!url) return 'your website'
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'your website'
  }
}

function ProgressMeter({ status }: { status: AuditStatus }) {
  const percent = STAGE_PROGRESS[status]
  const current = STAGE_INDEX[status]

  return (
    <section className="card scan-progress" aria-labelledby="scan-progress-title">
      <header className="scan-progress-head">
        <div>
          <span className="scan-console-eyebrow">
            <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
            Progress
          </span>
          <h2 id="scan-progress-title">Work completed</h2>
        </div>
        <p className="scan-progress-pct">
          {percent}
          <small>%</small>
        </p>
      </header>

      <div className="scan-progress-value">
        <p className="scan-progress-caption">{STAGE_DESCRIPTION[status]}</p>
      </div>

      <div
        className="scan-progress-track"
        role="progressbar"
        aria-label="Audit completion"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="scan-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      <div className="scan-progress-stages" aria-hidden="true">
        {STAGE_LABELS.map((label, index) => (
          <span
            key={label}
            className="scan-progress-stage"
            data-state={index < current ? 'done' : index === current ? 'active' : 'pending'}
          >
            {label}
          </span>
        ))}
      </div>

      <p className="scan-progress-note">
        Based on the current audit stage. Results open automatically when the scan hands off.
      </p>
    </section>
  )
}

export function AuditLoadingScreen({
  job,
  websiteUrl,
  repoFullName,
}: {
  job: AuditJob | null
  websiteUrl?: string
  repoFullName?: string
}) {
  const status = job?.status ?? 'queued'
  const percent = STAGE_PROGRESS[status]
  const host = hostFrom(websiteUrl)

  const title =
    status === 'queued'
      ? 'Preparing your audit'
      : status === 'scanning'
        ? `Scanning ${host}`
        : status === 'dispatching'
          ? 'Dispatching your audit'
          : status === 'failed'
            ? 'Audit stopped'
            : 'Finishing your audit'

  const description =
    status === 'queued'
      ? 'Your audit is queued for a scanner worker. The console updates as each stage completes.'
      : status === 'scanning'
        ? 'A headless browser is rendering your page and running the accessibility audit. This usually takes a moment.'
        : status === 'dispatching'
          ? 'The audit is complete. Findings are being grouped and handed to the remediation workflow.'
          : status === 'failed'
            ? 'The audit stopped before completing. The results page shows the details.'
            : 'The scan is complete. Preparing your results now.'

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <div className="workspace-intro relative overflow-hidden rounded-2xl border border-brand-200 p-6 sm:p-8">
        <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-70" aria-hidden="true" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span className="eyebrow">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              Audit in progress
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">
              {title}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-navy-600">{description}</p>
          </div>
          <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-[#cfe0fb] bg-white/80 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-[#214e9f] backdrop-blur sm:self-auto">
            <i className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse-dot" aria-hidden="true" />
            Live
          </span>
        </div>
      </div>

      <div className="card mt-6 overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-navy-100 px-6 py-4">
          <h2 className="flex items-center gap-2 text-sm font-bold text-navy-900">
            <Activity className="h-4 w-4 text-brand-600" aria-hidden="true" />
            Audit lifecycle
          </h2>
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-navy-400">
            Auto-updating
          </span>
        </div>
        <div className="px-5 py-6 sm:px-6">
          <StatusStepper status={status} />
        </div>
      </div>

      <div className="mt-6 grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <ScanConsole
          websiteUrl={websiteUrl ?? ''}
          repoFullName={repoFullName ?? null}
          status={status}
        />
        <ProgressMeter status={status} />
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {STAGE_LABELS[Math.max(STAGE_INDEX[status], 0)]} stage — {percent}% of the audit lifecycle complete.
      </p>
    </div>
  )
}
