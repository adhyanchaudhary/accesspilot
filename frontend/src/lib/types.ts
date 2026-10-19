export interface GitHubUser {
  id: number
  login: string
}

export interface Session {
  user: GitHubUser
  csrf_token: string
}

export interface Repository {
  id: number
  installation_id: number
  full_name: string
  private: boolean
  default_branch: string
}

/**
 * Lifecycle reported by `GET /audits/{job_id}`.
 * `submitted` means the audit payload was accepted by the n8n workflow.
 * It does NOT mean GitHub remediation has finished.
 */
export type AuditStatus =
  | 'queued'
  | 'scanning'
  | 'dispatching'
  | 'submitted'
  | 'failed'

export interface AuditSummary {
  violation_count: number
  affected_element_count: number
}

/**
 * Safe remediation fields reported by `GET /audits/{job_id}`. The UI only
 * renders what the backend provides and never fabricates a PR or commit.
 */
export interface RemediationResult {
  status?: 'in_progress' | 'completed' | 'failed'
  error?: string
  pr_url?: string
  branch?: string
  commit_sha?: string
}

export interface Violation {
  id: string
  description: string
  impact: string | null
  nodes: { html: string; target: unknown[]; failureSummary?: string }[]
}

export interface AuditJob {
  job_id: string
  status: AuditStatus
  error: string | null
  summary: AuditSummary | null
  remediation: RemediationResult | null
  audit: { violations: Violation[] } | null
}

export interface SubmitAuditInput {
  website_url: string
  installation_id: number
  repository_id: number
}

export interface HealthResponse {
  status: string
}
