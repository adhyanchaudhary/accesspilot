import type {
  AuditJob,
  HealthResponse,
  RemediationResult,
  Repository,
  Session,
  SubmitAuditInput,
} from './types'

export const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
).replace(/\/+$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown

  constructor(status: number, message: string, detail?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = detail
  }

  get isSessionExpired(): boolean {
    return this.status === 401
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0]
    if (first && typeof first === 'object' && 'msg' in first) {
      return String((first as { msg: unknown }).msg)
    }
  }
  if (detail && typeof detail === 'object' && 'msg' in detail) {
    return String((detail as { msg: unknown }).msg)
  }
  return ''
}

interface RequestOptions {
  method?: string
  body?: unknown
  csrfToken?: string
  idempotencyKey?: string
  signal?: AbortSignal
}

/**
 * Single entry point for backend calls. Always sends cookies so the
 * HttpOnly session cookie is included; never stores tokens in the browser.
 */
async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, csrfToken, idempotencyKey, signal } = options

  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      credentials: 'include',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'Cannot reach the AccessPilot backend. Is it running?')
  }

  let payload: unknown = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : payload
    const message = detailMessage(detail) || `Request failed (${response.status})`
    throw new ApiError(response.status, message, detail)
  }

  if (!payload || typeof payload !== 'object') throw new ApiError(502, 'Malformed backend response')
  return payload as T
}

function malformed(): never { throw new ApiError(502, 'Malformed backend response') }
const validStatus = (s: unknown) => typeof s === 'string' && ['queued', 'scanning', 'dispatching', 'submitted', 'failed'].includes(s)
const count = (n: unknown) => Number.isSafeInteger(n) && Number(n) >= 0
function validRemediation(r: RemediationResult): boolean {
  if (!['in_progress', 'completed', 'failed'].includes(r.status ?? '')) return false
  if (r.error != null && typeof r.error !== 'string') return false
  if (r.branch != null && typeof r.branch !== 'string') return false
  if (r.commit_sha != null && (typeof r.commit_sha !== 'string' || !/^[a-f0-9]{40}$/.test(r.commit_sha))) return false
  if (r.pr_url != null && (typeof r.pr_url !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(r.pr_url))) return false
  return r.status !== 'completed' || Boolean(r.pr_url && r.commit_sha && r.branch)
}

export const api = {
  /** Starts OAuth using a full browser navigation, never a background fetch. */
  loginUrl(): string {
    return `${API_BASE_URL}/auth/github/login`
  },

  /** Same, for installing the GitHub App on more repositories. */
  installUrl(): string {
    return `${API_BASE_URL}/github/install`
  },

  async health(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>('/health', { signal })
  },

  async githubHealth(signal?: AbortSignal): Promise<HealthResponse> {
    return request<HealthResponse>('/health/github', { signal })
  },

  async getSession(signal?: AbortSignal): Promise<Session> {
    const data = await request<Session>('/auth/github/me', { signal })
    if (!Number.isSafeInteger(data.user?.id) || typeof data.user?.login !== 'string' ||
        typeof data.csrf_token !== 'string' || !data.csrf_token) malformed()
    return data
  },

  async listRepositories(signal?: AbortSignal): Promise<Repository[]> {
    const data = await request<{ repositories: Repository[] }>(
      '/github/repositories',
      { signal },
    )
    if (!Array.isArray(data.repositories) || !data.repositories.every(r => r &&
      Number.isSafeInteger(r.id) && r.id > 0 && Number.isSafeInteger(r.installation_id) &&
      r.installation_id > 0 && typeof r.full_name === 'string' &&
      typeof r.default_branch === 'string' && typeof r.private === 'boolean')) malformed()
    return data.repositories
  },

  async submitAudit(
    input: SubmitAuditInput,
    csrfToken: string,
    idempotencyKey: string,
  ): Promise<{ job_id: string; status: string }> {
    const data = await request<{ job_id: string; status: string }>('/audits', {
      method: 'POST',
      body: input,
      csrfToken,
      idempotencyKey,
    })
    if (typeof data.job_id !== 'string' || !data.job_id || !validStatus(data.status)) malformed()
    return data
  },

  async getAudit(jobId: string, signal?: AbortSignal): Promise<AuditJob> {
    const data = await request<AuditJob & { remediation?: RemediationResult | null }>(
      `/audits/${encodeURIComponent(jobId)}`,
      { signal },
    )
    if (data.job_id !== jobId || !validStatus(data.status) ||
        (data.error != null && typeof data.error !== 'string') ||
        (data.summary != null && (!count(data.summary.violation_count) || !count(data.summary.affected_element_count))) ||
        (data.remediation != null && !validRemediation(data.remediation)) ||
        (data.audit != null && (!Array.isArray(data.audit.violations) || !data.audit.violations.every(v =>
          v && typeof v.id === 'string' && typeof v.description === 'string' &&
          (v.impact === null || ['minor','moderate','serious','critical'].includes(v.impact)) &&
          Array.isArray(v.nodes) && v.nodes.every(n => n && typeof n.html === 'string' && Array.isArray(n.target) &&
          (n.failureSummary == null || typeof n.failureSummary === 'string')))))) malformed()
    return {
      job_id: data.job_id,
      status: data.status,
      error: data.error ?? null,
      summary: data.summary ?? null,
      remediation: data.remediation ?? null,
      audit: data.audit ?? null,
    }
  },

  async logout(csrfToken: string): Promise<void> {
    await request('/auth/logout', { method: 'POST', csrfToken })
  },
}
