import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  headingLevel = 3,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  headingLevel?: 1 | 2 | 3
}) {
  const Heading = `h${headingLevel}` as 'h1' | 'h2' | 'h3'
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-navy-200 bg-navy-50/50 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-full bg-white text-navy-400 shadow-sm">
        <Icon className="h-6 w-6" aria-hidden="true" />
      </span>
      <Heading className="mt-4 text-base font-semibold text-navy-900">{title}</Heading>
      <p className="mt-1 max-w-sm text-sm text-navy-500">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
