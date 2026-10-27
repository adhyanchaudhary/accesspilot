import {
  ExternalLink,
  GitBranch,
  GitCommitHorizontal,
  GitPullRequest,
  Sparkles,
} from 'lucide-react'
import type { AuditStatus, RemediationResult } from '../lib/types'
import { Spinner } from './Spinner'

function DetailRow({
  icon: Icon,
  label,
  value,
  mono = true,
}: {
  icon: typeof GitBranch
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="inline-flex shrink-0 items-center gap-2 text-sm text-navy-500">
        <Icon className="h-4 w-4 text-navy-400" aria-hidden="true" />
        {label}
      </span>
      <span
        className={`min-w-0 truncate text-sm font-medium text-navy-900 ${mono ? 'font-mono' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}

/**
 * Renders only what the backend actually reports. PR URLs and SHAs are never
 * fabricated; when absent, the panel explains the current, honest stage.
 */
export function RemediationPanel({
  remediation,
  status,
}: {
  remediation: RemediationResult | null | undefined
  status: AuditStatus
}) {
  const prUrl = remediation?.pr_url

  if (prUrl) {
    return (
      <div className="card overflow-hidden">
        <div className="flex items-start gap-3 border-b border-navy-100 bg-emerald-50/60 px-5 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500 text-white">
            <GitPullRequest className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-navy-900">Draft pull request ready</h3>
            <p className="text-xs text-navy-500">
              Review the proposed accessibility fixes before merging.
            </p>
          </div>
        </div>
        <div className="px-5 py-4">
          <a
            href={prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary w-full"
          >
            Open draft pull request
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
          <div className="mt-4 divide-y divide-navy-50">
            {remediation?.branch && (
              <DetailRow icon={GitBranch} label="Branch" value={remediation.branch} />
            )}
            {remediation?.commit_sha && (
              <DetailRow
                icon={GitCommitHorizontal}
                label="Commit"
                value={remediation.commit_sha.slice(0, 12)}
              />
            )}
          </div>
        </div>
      </div>
    )
  }

  if (remediation?.status === 'no_changes') {
    const message = remediation.reason === 'no_violations'
      ? 'No automatically detectable violations found. This does not certify full accessibility.'
      : remediation.reason === 'no_candidate_files'
        ? 'No matching source files were identified. Review the scan findings manually.'
        : 'No automatic code changes were proposed. Review any remaining findings manually.'
    return <div className="card p-5"><h3 className="text-sm font-bold">Scan complete — no draft PR</h3><p className="mt-2 text-sm">{message}</p></div>
  }

  if (remediation?.status === 'failed') {
    return <div className="card p-5" role="alert">
      <h3 className="text-sm font-bold">Remediation needs attention</h3>
      <p className="mt-2 text-sm">The backend could not confirm remediation completion. Check the n8n execution before retrying; partial GitHub work may exist.</p>
      <p className="mt-2 font-mono text-xs">{remediation.reason ?? remediation.error}</p>
    </div>
  }

  if (remediation?.status) {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-100 text-navy-700">
            <Sparkles className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-navy-900">Remediation in progress</h3>
            <p className="text-xs text-navy-500">
              Backend status: <span className="font-mono">{remediation.status}</span>
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (status === 'failed') {
    return (
      <div className="card p-5">
        <h3 className="text-sm font-bold text-navy-900">No remediation was created</h3>
        <p className="mt-1 text-sm text-navy-500">
          The audit failed before a pull request could be generated. Resolve the error and
          run a new audit.
        </p>
      </div>
    )
  }

  if (status === 'submitted') {
    return (
      <div className="card p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
            <Spinner className="h-5 w-5" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-navy-900">Waiting for AI remediation</h3>
            <p className="text-xs text-navy-500">
              The audit was accepted by the workflow. A draft pull request link will appear
              here once the backend reports it.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="card p-5">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-navy-100 text-navy-400">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-bold text-navy-900">Remediation not started</h3>
          <p className="text-xs text-navy-500">
            Remediation begins after the audit is submitted to the workflow.
          </p>
        </div>
      </div>
    </div>
  )
}
