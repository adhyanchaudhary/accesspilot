import { Check, X } from 'lucide-react'
import { AUDIT_STATUS_META } from '../lib/status'
import type { AuditStatus } from '../lib/types'
import { Spinner } from './Spinner'

const ORDER: AuditStatus[] = ['queued', 'scanning', 'dispatching', 'submitted']

/**
 * Horizontal lifecycle stepper driven entirely by the backend status.
 * It reflects real stages only and never implies a fabricated percentage.
 */
export function StatusStepper({ status }: { status: AuditStatus }) {
  const failed = status === 'failed'
  const currentIndex = ORDER.indexOf(status)

  return (
    <ol className="flex items-start" aria-label="Audit lifecycle">
      {ORDER.map((step, index) => {
        const meta = AUDIT_STATUS_META[step]
        const done = !failed && currentIndex > index
        const active = !failed && currentIndex === index
        const isLast = index === ORDER.length - 1

        return (
          <li
            key={step}
            className="relative flex flex-1 flex-col items-center text-center"
            aria-current={active ? 'step' : undefined}
          >
            {!isLast && (
              <span
                className={`absolute left-[calc(50%+22px)] right-[calc(-50%+22px)] top-[19px] h-0.5 ${
                  done
                    ? 'bg-[repeating-linear-gradient(90deg,#8cd9bd_0_5px,transparent_5px_10px)]'
                    : 'bg-[repeating-linear-gradient(90deg,#cddaf0_0_5px,transparent_5px_10px)]'
                }`}
                aria-hidden="true"
              />
            )}
            <span
              className={`grid h-10 w-10 place-items-center rounded-full border text-sm font-bold transition ${
                done
                  ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
                  : active
                    ? 'border-transparent bg-gradient-to-br from-navy-800 to-brand-600 text-white shadow-glow'
                    : 'border-navy-200 bg-white text-navy-400'
              }`}
            >
              {done ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : active && step === 'submitted' ? (
                <Check className="h-5 w-5" aria-hidden="true" />
              ) : active ? (
                <Spinner className="h-5 w-5" />
              ) : (
                <span className="font-mono">{index + 1}</span>
              )}
            </span>
            <span
              className={`mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] ${
                done ? 'text-emerald-700' : active ? 'text-brand-700' : 'text-navy-400'
              }`}
            >
              {meta.label}
            </span>
          </li>
        )
      })}

      {failed && (
        <li className="relative ml-4 flex flex-1 flex-col items-center text-center">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-red-500 text-white">
            <X className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="mt-2 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-red-700">
            Failed
          </span>
        </li>
      )}
    </ol>
  )
}
