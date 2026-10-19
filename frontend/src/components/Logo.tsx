import { Accessibility } from 'lucide-react'
import { Link } from 'react-router-dom'

export function Logo({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="inline-flex items-center gap-2.5" aria-label="AccessPilot home">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-navy-800 to-brand-600 text-white shadow-sm">
        <Accessibility className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-navy-900">
        Access<span className="text-brand-600">Pilot</span>
      </span>
    </Link>
  )
}
