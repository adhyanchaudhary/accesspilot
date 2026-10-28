import { useState } from 'react'
import { ChangesViewerContent } from '../components/ChangesViewer'
import { ViolationList } from '../components/ViolationList'
import { RemediationPanel } from '../components/RemediationPanel'
import type { AuditChanges, AuditJob } from '../lib/types'
import '../components/Workspace.css'

const findings = [
  { id: 'image-alt', description: 'Ensure images have alternative text', impact: 'serious', nodes: [{ html: '<img src="hero.png">', target: ['.hero img'] }] },
  { id: 'button-name', description: 'Ensure buttons have discernible text', impact: 'critical', nodes: [{ html: '<button>+</button>', target: ['.add-button'] }] },
]
const changes: AuditChanges = {
  job_id: 'local-preview', status: 'completed', reason: null,
  base_sha: 'a'.repeat(40), commit_sha: 'b'.repeat(40), branch: 'preview/accessibility-fixes',
  files: [
    { file_path: 'src/Hero.jsx', issue_ids: ['image-alt'], old: '<img src="hero.png" />', updated: '<img src="hero.png" alt="Entrance to our store" />' },
    { file_path: 'src/Cart.jsx', issue_ids: ['button-name'], old: '<button>+</button>', updated: '<button aria-label="Add to cart">+</button>' },
  ].map(file => ({
    file_path: file.file_path, issue_ids: file.issue_ids, status: 'available', reason: null, additions: 1, deletions: 1,
    hunks: [{ old_start: 1, old_count: 1, new_start: 1, new_count: 1, lines: [
      { kind: 'delete', old_line: 1, new_line: null, text: file.old, ending: 'lf' },
      { kind: 'add', old_line: null, new_line: 1, text: file.updated, ending: 'lf' },
    ] }],
  })),
}
const loadChanges = async () => changes
const expireSession = () => {}

export default function AuditPreview() {
  const [state, setState] = useState('completed')
  const job: AuditJob = {
    job_id: 'local-preview', status: state === 'no_changes' ? 'completed' : 'submitted', error: null,
    summary: { violation_count: state === 'no_changes' ? 0 : 2, affected_element_count: state === 'no_changes' ? 0 : 2 },
    audit: { violations: state === 'no_changes' ? [] : findings },
    remediation: state === 'completed'
      ? { status: 'completed', commit_sha: changes.commit_sha, branch: changes.branch }
      : state === 'failed' ? { status: 'failed', reason: 'agent_failed' }
      : state === 'no_changes' ? { status: 'no_changes', reason: 'no_violations' } : null,
  }
  return <div className="workspace workspace-report min-h-screen">
    <main className="mx-auto max-w-[1600px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div><h1 className="text-2xl font-semibold">Audit results · UI preview</h1>
          <p className="mt-2 text-sm text-slate-600">Sample data only. No scan, login, API request, or real pull request.</p></div>
        <label className="flex items-center gap-3 text-sm font-medium">Preview state
          <select className="rounded-md border border-slate-300 bg-white px-3 py-2" value={state} onChange={event => setState(event.target.value)}>
            <option value="completed">Proposed changes</option><option value="no_changes">No issues found</option>
            <option value="failed">Workflow failed</option><option value="pending">Awaiting changes</option>
          </select>
        </label>
      </header>
      <div className="audit-review-grid">
        <div className="min-w-0 space-y-4">
          <ViolationList violations={job.audit!.violations} />
          <RemediationPanel remediation={job.remediation} status={job.status} />
        </div>
        <div className="min-w-0 audit-review-code">
          <ChangesViewerContent key={state} job={job} loadChanges={loadChanges} expireSession={expireSession} />
        </div>
      </div>
    </main>
  </div>
}
