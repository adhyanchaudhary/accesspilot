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
  | 'completed'
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
  status?: 'in_progress' | 'completed' | 'failed' | 'no_changes'
  reason?: 'no_violations' | 'no_candidate_files' | 'no_changes' | 'validation_failed' | 'agent_failed'
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

export interface DiffLine {
  kind: 'context' | 'add' | 'delete'
  old_line: number | null
  new_line: number | null
  text: string
  ending: 'lf' | 'crlf' | 'cr' | 'none'
}

export interface DiffHunk {
  old_start: number
  old_count: number
  new_start: number
  new_count: number
  lines: DiffLine[]
}

export interface FileDiff {
  file_path: string
  status: 'available' | 'unavailable'
  reason: string | null
  additions: number | null
  deletions: number | null
  issue_ids: string[]
  old_blob_sha?: string
  new_blob_sha?: string
  hunks: DiffHunk[]
}

export interface AuditChanges {
  job_id: string
  status: 'pending' | 'completed' | 'unavailable'
  reason: string | null
  base_sha?: string
  commit_sha?: string
  branch?: string
  files: FileDiff[]
}
