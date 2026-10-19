import { AlertTriangle, CheckCircle2, Info, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

type AlertVariant = 'error' | 'warning' | 'info' | 'success'

const VARIANTS: Record<
  AlertVariant,
  { icon: LucideIcon; className: string; iconClassName: string }
> = {
  error: {
    icon: AlertTriangle,
    className: 'border-red-200 bg-red-50 text-red-800',
    iconClassName: 'text-red-500',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-amber-200 bg-amber-50 text-amber-800',
    iconClassName: 'text-amber-500',
  },
  info: {
    icon: Info,
    className: 'border-navy-200 bg-navy-50 text-navy-800',
    iconClassName: 'text-navy-500',
  },
  success: {
    icon: CheckCircle2,
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    iconClassName: 'text-emerald-500',
  },
}

export function Alert({
  variant = 'info',
  title,
  children,
}: {
  variant?: AlertVariant
  title?: string
  children: ReactNode
}) {
  const { icon: Icon, className, iconClassName } = VARIANTS[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${className}`}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClassName}`} aria-hidden="true" />
      <div className="space-y-0.5">
        {title && <p className="font-semibold">{title}</p>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  )
}
