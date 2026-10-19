import { TONE_CLASSES, statusMeta } from '../lib/status'
import type { AuditStatus } from '../lib/types'
import { Spinner } from './Spinner'

export function StatusBadge({ status }: { status: AuditStatus | undefined }) {
  const meta = statusMeta(status)
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset ${TONE_CLASSES[meta.tone]}`}
    >
      {meta.active && <Spinner className="h-3.5 w-3.5" />}
      {meta.label}
    </span>
  )
}
