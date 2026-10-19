import type { AuditStatus } from './types'

export type StatusTone = 'idle' | 'active' | 'success' | 'error'

export interface StatusMeta {
  label: string
  description: string
  tone: StatusTone
  /** Whether the backend is still working and the client should keep polling. */
  active: boolean
}

export const AUDIT_STATUS_META: Record<AuditStatus, StatusMeta> = {
  queued: {
    label: 'Queued',
    description: 'The audit is waiting for a scanner worker.',
    tone: 'idle',
    active: true,
  },
  scanning: {
    label: 'Scanning',
    description: 'Rendering your page and running the accessibility engine.',
    tone: 'active',
    active: true,
  },
  dispatching: {
    label: 'Dispatching',
    description: 'Sending the audit to the remediation workflow.',
    tone: 'active',
    active: true,
  },
  submitted: {
    label: 'Submitted',
    description:
      'The audit reached the remediation workflow. AI remediation may still be running.',
    tone: 'success',
    active: false,
  },
  failed: {
    label: 'Failed',
    description: 'The audit could not be completed.',
    tone: 'error',
    active: false,
  },
}

export function statusMeta(status: AuditStatus | undefined): StatusMeta {
  if (!status) {
    return {
      label: 'Unknown',
      description: 'No status has been reported for this audit.',
      tone: 'idle',
      active: false,
    }
  }
  return AUDIT_STATUS_META[status]
}

export const TONE_CLASSES: Record<StatusTone, string> = {
  idle: 'bg-navy-100 text-navy-700 ring-navy-200',
  active: 'bg-amber-50 text-amber-700 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  error: 'bg-red-50 text-red-700 ring-red-200',
}
