import { AlertOctagon, ScanSearch } from 'lucide-react'
import type { AuditStatus, AuditSummary } from '../lib/types'

function StatCard({
  icon: Icon,
  value,
  label,
  tone,
}: {
  icon: typeof AlertOctagon
  value: string
  label: string
  tone: 'critical' | 'warning'
}) {
  const toneClasses =
    tone === 'critical'
      ? 'bg-red-50 text-red-600'
      : 'bg-amber-50 text-amber-600'
  return (
    <div className="card flex h-full items-center gap-4 p-5">
      <span className={`grid h-11 w-11 place-items-center rounded-xl ${toneClasses}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <div>
        <p className="font-display text-3xl font-bold leading-none text-navy-900">{value}</p>
        <p className="mt-1 text-sm font-medium text-navy-500">{label}</p>
      </div>
    </div>
  )
}

function StatSkeleton({ label }: { label: string }) {
  return (
    <div className="card flex items-center gap-4 p-5" aria-busy="true">
      <div className="skeleton h-11 w-11 rounded-xl" />
      <div className="space-y-2">
        <div className="skeleton h-5 w-12" />
        <p className="text-sm font-medium text-navy-400">{label}</p>
      </div>
    </div>
  )
}

export function ViolationSummary({
  summary,
  status,
}: {
  summary: AuditSummary | null
  status: AuditStatus
}) {
  const pending = summary === null && (status === 'queued' || status === 'scanning')
  const scanning = pending && status === 'scanning'

  if (scanning) {
    return (
      <div className="grid h-full gap-4 sm:grid-cols-2">
        <StatSkeleton label="Accessibility violations" />
        <StatSkeleton label="Affected elements" />
      </div>
    )
  }

  if (summary) {
    return (
      <div className="grid h-full gap-4 sm:grid-cols-2">
        <StatCard
          icon={AlertOctagon}
          value={summary.violation_count.toLocaleString()}
          label={
            summary.violation_count === 1
              ? 'Accessibility violation'
              : 'Accessibility violations'
          }
          tone={summary.violation_count > 0 ? 'critical' : 'warning'}
        />
        <StatCard
          icon={ScanSearch}
          value={summary.affected_element_count.toLocaleString()}
          label={
            summary.affected_element_count === 1
              ? 'Affected element'
              : 'Affected elements'
          }
          tone="warning"
        />
      </div>
    )
  }

  return (
    <div className="card p-5">
      <p className="text-sm text-navy-500">
        No violation summary has been reported for this audit yet.
      </p>
    </div>
  )
}
