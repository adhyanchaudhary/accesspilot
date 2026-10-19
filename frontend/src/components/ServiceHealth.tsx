import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api, isApiError } from '../lib/api'
import { Corners } from './Corners'
import { Spinner } from './Spinner'

type ProbeState = 'checking' | 'ok' | 'error'

interface Probe {
  state: ProbeState
  detail: string | null
}

interface HealthState {
  backend: Probe
  github: Probe
}

const CHECKING: Probe = { state: 'checking', detail: null }

function probeMessage(cause: unknown): string {
  return isApiError(cause) ? cause.message : 'The backend could not be reached.'
}

function StatusRow({
  icon: Icon,
  label,
  probe,
}: {
  icon: LucideIcon
  label: string
  probe: Probe
}) {
  const tone =
    probe.state === 'ok'
      ? 'text-emerald-600'
      : probe.state === 'error'
        ? 'text-red-600'
        : 'text-amber-600'

  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="inline-flex items-center gap-2 text-sm text-navy-600">
        <Icon className="h-4 w-4 text-navy-400" aria-hidden="true" />
        {label}
      </span>
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${tone}`}>
        {probe.state === 'checking' ? (
          <>
            <Spinner className="h-3.5 w-3.5" />
            Checking
          </>
        ) : probe.state === 'ok' ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Online
          </>
        ) : (
          <>
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Unavailable
          </>
        )}
      </span>
      {probe.state === 'error' && probe.detail && (
        <span className="sr-only">{probe.detail}</span>
      )}
    </div>
  )
}

/**
 * Probes the public readiness route and the authenticated GitHub App check.
 * No tokens, diagnostics or upstream error text are rendered.
 */
export function ServiceHealth() {
  const { expireSession } = useAuth()
  const [health, setHealth] = useState<HealthState>({
    backend: CHECKING,
    github: CHECKING,
  })
  const [refreshing, setRefreshing] = useState(false)
  const controllerRef = useRef<AbortController | null>(null)

  const check = useCallback(async () => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const aborted = () => controller.signal.aborted

    setRefreshing(true)
    setHealth({ backend: CHECKING, github: CHECKING })
    try {
      try {
        await api.health(controller.signal)
        if (!aborted()) setHealth((current) => ({ ...current, backend: { state: 'ok', detail: null } }))
      } catch (cause) {
        if (aborted()) return
        if (isApiError(cause) && cause.isSessionExpired) {
          expireSession()
          return
        }
        const detail = probeMessage(cause)
        setHealth({
          backend: { state: 'error', detail },
          github: { state: 'error', detail: 'Backend API is unavailable' },
        })
        return
      }

      try {
        await api.githubHealth(controller.signal)
        if (!aborted()) setHealth((current) => ({ ...current, github: { state: 'ok', detail: null } }))
      } catch (cause) {
        if (aborted()) return
        if (isApiError(cause) && cause.isSessionExpired) {
          expireSession()
          return
        }
        setHealth((current) => ({
          ...current,
          github: { state: 'error', detail: probeMessage(cause) },
        }))
      }
    } finally {
      if (!aborted()) setRefreshing(false)
    }
  }, [expireSession])

  useEffect(() => {
    void check()
    return () => controllerRef.current?.abort()
  }, [check])

  return (
    <div className="card p-5">
      <Corners />
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-navy-900">
          <ServerCog className="h-4 w-4 text-brand-600" aria-hidden="true" />
          Service status
        </h2>
        <button
          type="button"
          onClick={() => void check()}
          disabled={refreshing}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-navy-500 hover:text-brand-700 disabled:opacity-60"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          Recheck
        </button>
      </div>
      <div className="mt-2 divide-y divide-navy-50">
        <StatusRow icon={ServerCog} label="Backend API" probe={health.backend} />
        <StatusRow icon={ShieldCheck} label="GitHub App" probe={health.github} />
      </div>
    </div>
  )
}
