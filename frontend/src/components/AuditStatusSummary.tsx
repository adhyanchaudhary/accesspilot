import { AlertOctagon, GitPullRequest, Loader2 } from 'lucide-react'
import type { AuditStatus, RemediationResult } from '../lib/types'

type Tone = 'success' | 'pending' | 'error'

const TONE_CLASSES: Record<Tone, string> = {
  success: 'bg-emerald-50 text-emerald-600',
  pending: 'bg-amber-50 text-amber-600',
  error: 'bg-red-50 text-red-600',
}

export function AuditStatusSummary({
  remediation,
  status,
}: {
  remediation: RemediationResult | null | undefined
  status: AuditStatus
}) {
  const completed = remediation?.status === 'completed'
  const failed = status === 'failed' || remediation?.status === 'failed'

  const noChanges = remediation?.status === 'no_changes'
  const tone: Tone = failed ? 'error' : (completed || noChanges) ? 'success' : 'pending'
  const title = failed
    ? status === 'failed'
      ? 'Audit failed'
      : 'Remediation failed'
    : noChanges ? 'Scan complete — no draft PR' : completed
      ? 'Draft PR confirmed'
      : status === 'submitted'
        ? 'Awaiting draft PR'
        : 'Audit in progress'
  const note = failed
    ? 'Review the details below before retrying.'
    : noChanges ? 'Review the findings and outcome below.' : completed
      ? 'Ready for human review.'
      : status === 'submitted'
        ? 'AI remediation is still running.'
        : 'Checking the latest audit stage.'

  return (
    <div className="card flex h-full items-center gap-4 p-5">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${TONE_CLASSES[tone]}`}>
        {failed ? (
          <AlertOctagon className="h-5 w-5" aria-hidden="true" />
        ) : (completed || noChanges) ? (
          <GitPullRequest className="h-5 w-5" aria-hidden="true" />
        ) : (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        )}
      </span>
      <div className="min-w-0">
        <p className="font-display text-lg font-bold leading-tight text-navy-900">{title}</p>
        <p className="mt-1 text-sm font-medium text-navy-500">{note}</p>
      </div>
    </div>
  )
}
