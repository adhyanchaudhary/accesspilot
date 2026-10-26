import { AlertCircle, CheckCircle2, ChevronDown, Code2, ShieldAlert } from 'lucide-react'
import type { Violation } from '../lib/types'

const IMPACTS: Record<string, { label: string; dot: string; badge: string }> = {
  critical: {
    label: 'Critical',
    dot: 'bg-rose-500',
    badge: 'border-rose-200 bg-rose-50 text-rose-700',
  },
  serious: {
    label: 'Serious',
    dot: 'bg-orange-500',
    badge: 'border-orange-200 bg-orange-50 text-orange-700',
  },
  moderate: {
    label: 'Moderate',
    dot: 'bg-amber-500',
    badge: 'border-amber-200 bg-amber-50 text-amber-700',
  },
  minor: {
    label: 'Minor',
    dot: 'bg-sky-500',
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
  },
}

const FALLBACK_IMPACT = {
  label: 'Review',
  dot: 'bg-navy-400',
  badge: 'border-navy-200 bg-navy-50 text-navy-600',
}

function impactFor(impact: string | null) {
  return (impact && IMPACTS[impact.toLowerCase()]) || FALLBACK_IMPACT
}

export function ViolationList({ violations }: { violations: Violation[] }) {
  const totalElements = violations.reduce((count, violation) => count + violation.nodes.length, 0)

  return (
    <section className="card overflow-hidden" aria-labelledby="issues-title">
      <header className="flex flex-col gap-4 border-b border-navy-100 px-5 py-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
            <ShieldAlert className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="issues-title" className="text-base font-bold text-navy-900">
              Detected accessibility issues
            </h2>
            <p className="mt-0.5 text-sm leading-relaxed text-navy-500">
              Grouped by axe-core rule, with the exact elements that need attention.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-navy-200 bg-white px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-navy-500">
            {violations.length} {violations.length === 1 ? 'rule' : 'rules'}
          </span>
          <span className="inline-flex items-center rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-brand-700">
            {totalElements} {totalElements === 1 ? 'element' : 'elements'}
          </span>
        </div>
      </header>

      {violations.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
          </span>
          <h3 className="text-base font-bold text-navy-900">No automated violations found</h3>
          <p className="max-w-md text-sm leading-relaxed text-navy-500">
            axe-core did not flag any issues on the scanned page. Manual checks are still
            recommended for content clarity and interaction quality.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-navy-100">
          {violations.map((violation, index) => {
            const impact = impactFor(violation.impact)
            return (
              <details key={`${violation.id}-${index}`} className="group">
                <summary className="flex cursor-pointer list-none items-start gap-3 px-5 py-4 transition hover:bg-[#f8fbff] [&::-webkit-details-marker]:hidden">
                  <span
                    className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${impact.dot}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="break-all font-mono text-sm font-bold text-navy-900">
                        {violation.id}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${impact.badge}`}
                      >
                        {impact.label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-md bg-navy-50 px-1.5 py-0.5 text-[10px] font-semibold text-navy-500 sm:hidden">
                        {violation.nodes.length} {violation.nodes.length === 1 ? 'element' : 'elements'}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-sm leading-relaxed text-navy-600">
                      {violation.description}
                    </span>
                  </span>
                  <span className="hidden shrink-0 items-center rounded-lg bg-navy-50 px-2 py-1 text-[11px] font-semibold text-navy-500 sm:inline-flex">
                    {violation.nodes.length} {violation.nodes.length === 1 ? 'element' : 'elements'}
                  </span>
                  <ChevronDown
                    className="mt-0.5 h-4 w-4 shrink-0 text-navy-400 transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>

                <div className="border-t border-navy-100 bg-[#fbfdff] px-5 pb-5 pt-4">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.14em] text-navy-400">
                    Affected elements
                  </p>
                  <div className="mt-3 space-y-3">
                    {violation.nodes.map((node, nodeIndex) => (
                      <div
                        key={nodeIndex}
                        className="rounded-xl border border-[#e2ebf9] bg-white p-3 shadow-[0_1px_0_rgba(255,255,255,0.85)_inset]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-brand-100 bg-brand-50 px-2 py-1 font-mono text-[10px] font-semibold text-brand-700">
                            <Code2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                            <span className="break-all">{JSON.stringify(node.target)}</span>
                          </span>
                          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-navy-400">
                            Element {nodeIndex + 1}
                          </span>
                        </div>
                        <pre className="mt-2.5 overflow-x-auto whitespace-pre-wrap break-words rounded-lg border border-[#dbe8fa] bg-[#f4f8ff] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#14315f]">
                          <code>{node.html}</code>
                        </pre>
                        {node.failureSummary && (
                          <div className="mt-2.5 flex gap-2 rounded-lg border border-amber-100 bg-amber-50/70 px-3 py-2 text-xs leading-relaxed text-amber-800">
                            <AlertCircle
                              className="mt-0.5 h-3.5 w-3.5 shrink-0"
                              aria-hidden="true"
                            />
                            <p>{node.failureSummary}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            )
          })}
        </div>
      )}
    </section>
  )
}
