export interface LatestJob {
  jobId: string
  websiteUrl: string
  repoFullName: string
  createdAt: string
}

const KEY = 'accesspilot.latestJob'

export function getLatestJob(): LatestJob | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LatestJob>
    if (typeof parsed.jobId === 'string' && parsed.jobId) {
      return {
        jobId: parsed.jobId,
        websiteUrl: parsed.websiteUrl ?? '',
        repoFullName: parsed.repoFullName ?? '',
        createdAt: parsed.createdAt ?? '',
      }
    }
    return null
  } catch {
    return null
  }
}

export function setLatestJob(job: LatestJob): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(job))
  } catch {
    // Storage may be unavailable (private mode); the app still works without it.
  }
}
