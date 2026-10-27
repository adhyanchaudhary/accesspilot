import { Check, Loader2, X } from 'lucide-react'
import { statusMeta } from '../lib/status'
import type { AuditStatus } from '../lib/types'

/**
 * Indeterminate lifecycle indicator. It intentionally shows no percentage
 * because the backend does not report granular progress.
 */
export function ScanIndicator({ status }: { status: AuditStatus }) {
  const meta = statusMeta(status)
  const active = meta.active
  const success = status === 'submitted' || status === 'completed'
  const failed = status === 'failed'

  const ringColor = success
    ? 'text-emerald-500'
    : failed
      ? 'text-red-500'
      : 'text-brand-500'
  const trackColor = success
    ? 'text-emerald-100'
    : failed
      ? 'text-red-100'
      : 'text-brand-100'

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-40 w-40">
        <div
          className={`absolute inset-3 rounded-full blur-xl ${success ? 'bg-emerald-200/50' : failed ? 'bg-red-200/50' : 'bg-brand-200/50'}`}
          aria-hidden="true"
        />
        <svg
          viewBox="0 0 180 180"
          className={`relative h-full w-full ${active ? 'animate-spin-slow' : ''} ${ringColor}`}
          aria-hidden="true"
        >
          <circle
            cx="90"
            cy="90"
            r="76"
            fill="none"
            strokeWidth="10"
            className={`${trackColor}`}
            stroke="currentColor"
          />
          <circle
            cx="90"
            cy="90"
            r="76"
            fill="none"
            strokeWidth="10"
            strokeLinecap="round"
            stroke="currentColor"
            strokeDasharray={active ? '118 360' : '477.5'}
            strokeDashoffset={active ? '0' : '0'}
          />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center">
          <span
            className={`mx-auto grid h-11 w-11 place-items-center rounded-full ${
              success
                ? 'bg-emerald-50 text-emerald-600'
                : failed
                  ? 'bg-red-50 text-red-600'
                  : 'bg-brand-50 text-brand-600'
            }`}
          >
            {success ? (
              <Check className="h-6 w-6" aria-hidden="true" />
            ) : failed ? (
              <X className="h-6 w-6" aria-hidden="true" />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
            )}
          </span>
          <span className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-navy-400">
            {meta.label}
          </span>
        </div>
      </div>
      <p className="mt-3 max-w-[15rem] text-center text-xs leading-relaxed text-navy-500">
        {meta.description}
      </p>
    </div>
  )
}
