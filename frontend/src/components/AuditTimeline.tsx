import { Check, Circle, X } from 'lucide-react'
import { AUDIT_STATUS_META } from '../lib/status'
import type { AuditStatus } from '../lib/types'
import { Spinner } from './Spinner'

const ORDER: AuditStatus[] = ['queued', 'scanning', 'dispatching', 'submitted']

export function AuditTimeline({ status }: { status: AuditStatus }) {
  const failed = status === 'failed'
  const currentIndex = ORDER.indexOf(status)

  return (
    <ol className="space-y-1" aria-label="Audit progress">
      {ORDER.map((step, index) => {
        const meta = AUDIT_STATUS_META[step]
        const done = !failed && currentIndex > index
        const active = !failed && currentIndex === index
        const isLast = index === ORDER.length - 1

        return (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-white ${
                  done
                    ? 'bg-emerald-500'
                    : active
                      ? 'bg-navy-700'
                      : 'bg-navy-100 text-navy-400'
                }`}
              >
                {done ? (
                  <Check className="h-4 w-4" aria-hidden="true" />
                ) : active ? (
                  <Spinner className="h-4 w-4" />
                ) : (
                  <Circle className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
                )}
              </span>
              {!isLast && (
                <span
                  className={`my-1 w-px flex-1 ${done ? 'bg-emerald-300' : 'bg-navy-100'}`}
                  aria-hidden="true"
                />
              )}
            </div>
            <div className={`pb-5 ${isLast ? 'pb-0' : ''}`}>
              <p
                className={`text-sm font-semibold ${
                  active || done ? 'text-navy-900' : 'text-navy-400'
                }`}
              >
                {meta.label}
              </p>
              <p className="text-xs text-navy-400">{meta.description}</p>
            </div>
          </li>
        )
      })}

      {failed && (
        <li className="flex gap-3">
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-red-500 text-white">
            <X className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold text-red-700">Failed</p>
            <p className="text-xs text-navy-400">
              The audit stopped before completion.
            </p>
          </div>
        </li>
      )}
    </ol>
  )
}
