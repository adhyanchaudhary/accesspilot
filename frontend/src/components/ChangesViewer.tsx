import { AlertCircle, Check, ChevronRight, Code2, Copy, ExternalLink, FileCode2, GitBranch, Terminal } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { api, ApiError, isApiError } from '../lib/api'
import type { AuditChanges, AuditJob } from '../lib/types'
import './ChangesViewer.css'
import { explainRule } from '../lib/axeRules'

export function ChangesViewer({ job }: { job: AuditJob }) {
  const { expireSession } = useAuth()
  const [data, setData] = useState<AuditChanges | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const commit = job.remediation?.status === 'completed' ? job.remediation.commit_sha : undefined

  useEffect(() => {
    setData(null); setError(null); setSelected(0); setCopyStatus('')
    if (!commit) { setLoading(false); return }
    let cancelled = false
    const controller = new AbortController()
    setLoading(true)
    api.getAuditChanges(job.job_id, controller.signal).then(result => {
      if (cancelled) return
      if (result.status === 'completed' && result.commit_sha !== commit) throw new ApiError(409, 'Preview commit does not match this audit.')
      setData(result)
    }).catch(cause => {
      if (cancelled || (cause instanceof DOMException && cause.name === 'AbortError')) return
      if (isApiError(cause) && cause.isSessionExpired) { expireSession(); return }
      setError(isApiError(cause) ? cause.message : 'Unable to load the code preview.')
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true; controller.abort() }
  }, [job.job_id, commit, retry, expireSession])

  const confirmed = data?.status === 'completed' && data.commit_sha === commit && data.job_id === job.job_id
  const files = confirmed ? data.files : []
  const file = files[selected]
  const available = files.filter(f => f.status === 'available')
  const additions = available.reduce((n, f) => n + (f.additions ?? 0), 0)
  const deletions = available.reduce((n, f) => n + (f.deletions ?? 0), 0)
  const incomplete = available.length !== files.length
  const waiting = job.remediation?.status !== 'no_changes' && job.status !== 'failed' && job.remediation?.status !== 'failed'

  async function copyPatch() {
    if (!file || file.status !== 'available') return
    const lines = [`--- a/${file.file_path}`, `+++ b/${file.file_path}`]
    for (const hunk of file.hunks) {
      lines.push(`@@ -${hunk.old_start},${hunk.old_count} +${hunk.new_start},${hunk.new_count} @@`)
      for (const line of hunk.lines) {
        lines.push((line.kind === 'add' ? '+' : line.kind === 'delete' ? '-' : ' ') + line.text + (line.ending === 'crlf' ? '\r' : ''))
        if (line.ending === 'none') lines.push('\\ No newline at end of file')
      }
    }
    try { await navigator.clipboard.writeText(lines.join('\n') + '\n'); setCopyStatus('Copied') }
    catch { setCopyStatus('Clipboard unavailable') }
  }

  return <section className="changes-viewer" aria-labelledby="changes-title">
    <header className="changes-heading">
      <div><span className="changes-eyebrow"><Terminal size={13} aria-hidden="true" /> Code review</span>
        <h2 id="changes-title">Proposed changes</h2><p>Read-only preview · {commit ? 'Draft PR · Not merged' : job.remediation?.status === 'no_changes' ? 'No changes proposed' : 'Awaiting a confirmed draft PR'}</p></div>
      <div className="changes-actions">{confirmed && <div className="diff-totals"><span>{files.length} {files.length === 1 ? 'file' : 'files'}</span>
        {available.length ? <><span className="diff-add">+{additions}</span><span className="diff-delete">−{deletions}</span>
        {incomplete && <span>visible changes only</span>}</> : <span>Counts unavailable</span>}</div>}
      {job.remediation?.status === 'completed' && job.remediation.pr_url && <a className="changes-pr" href={job.remediation.pr_url} target="_blank" rel="noopener noreferrer">Open draft PR<ExternalLink size={13} aria-hidden="true" /></a>}</div>
    </header>
    {!confirmed || !file ? <div className="changes-empty" role={error ? 'alert' : 'status'}>
      {error ? <AlertCircle size={28} aria-hidden="true" /> : <Code2 size={28} aria-hidden="true" />}
      <h3>{loading ? 'Loading confirmed changes…' : error ? 'Code preview unavailable' :
        data?.status === 'unavailable' ? 'No preview recorded for this audit' : !waiting ? 'No confirmed code changes' : 'Waiting for confirmed changes'}</h3>
      <p>{error ?? (loading ? 'Checking your repository access and pinned comparison.' :
        data?.status === 'unavailable' ? 'This job has no confirmed preview. Older jobs need a fresh audit; a confirmed draft PR can still be reviewed on GitHub.' :
        job.remediation?.status === 'no_changes' ? 'No code changes were produced. Review the scan outcome above.' : !waiting ? 'The audit or remediation needs attention. No successful changes are being claimed.' :
        'The diff appears here after the backend confirms a draft pull request. Workflow submission alone does not mean the fixes are finished.')}</p>
      {error && <button type="button" className="btn-secondary" onClick={() => setRetry(n => n + 1)}>Retry preview</button>}
    </div> : <>
      <div className="changes-workbench">
        <nav className="changes-files" aria-label="Changed files">
          <p className="changes-files-label">Explorer <span>{files.length}</span></p>
          {files.map((item, index) => <button key={`${item.file_path}-${index}`} type="button"
            className={index === selected ? 'selected' : ''} aria-pressed={index === selected}
            onClick={() => { setSelected(index); setCopyStatus('') }}>
            <FileCode2 size={15} aria-hidden="true" /><span className="changes-path" title={item.file_path}>{item.file_path}</span>
            {item.status === 'available' ? <span className="changes-file-count"><b className="diff-add">+{item.additions}</b> <b className="diff-delete">−{item.deletions}</b></span> : <span className="changes-file-count">Limited</span>}
          </button>)}
        </nav>
        <div className="changes-editor">
          <div className="changes-tab"><div><FileCode2 size={15} aria-hidden="true" /><span>{file.file_path}</span><span className="changes-modified">M</span></div>
            {file.status === 'available' && <button type="button" className="changes-copy" onClick={copyPatch} aria-label="Copy visible patch">
              {copyStatus === 'Copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}Copy patch</button>}</div>
          {file.status === 'available' ? <>
            <div className="proposed-rule-explanations">
              {file.issue_ids.length > 0 && <p>Proposed fixes · Not yet verified by a new scan</p>}
              {[...new Set(file.issue_ids)].map(id => {
                const finding = job.audit?.violations.find(item => item.id === id)
                const rule = explainRule(id, finding?.description)
                return <details key={id}>
                  <summary>{rule.title}</summary>
                  <p><strong>Why it matters:</strong> {rule.why}</p>
                  <p><strong>Suggested approach:</strong> {rule.suggestion}</p>
                  <p>Technical rule: <code>{id}</code></p>
                  {finding && <p>Original finding: {finding.description}</p>}
                </details>
              })}
            </div>
            <div className="changes-issues">Unified diff · 3 lines of context</div>
            <div className="diff-scroll" tabIndex={0} role="region" aria-label={`Code diff for ${file.file_path}`}>
              <table className="diff-table"><caption className="sr-only">Original and proposed code. Plus marks additions; minus marks deletions. Old and new line numbers are shown.</caption>
                <thead className="sr-only"><tr><th>Old line</th><th>New line</th><th>Change</th><th>Source code</th></tr></thead>
                {file.hunks.map((hunk, i) => <tbody key={i}>
                  <tr className="diff-hunk"><td colSpan={4}>@@ −{hunk.old_start},{hunk.old_count} +{hunk.new_start},{hunk.new_count} @@</td></tr>
                  {hunk.lines.map((line, j) => <tr key={j} className={`diff-row diff-${line.kind}`}>
                    <td className="diff-number">{line.old_line}</td><td className="diff-number">{line.new_line}</td>
                    <td className="diff-sign"><span aria-hidden="true">{line.kind === 'add' ? '+' : line.kind === 'delete' ? '−' : ' '}</span><span className="sr-only">{line.kind === 'add' ? 'Added' : line.kind === 'delete' ? 'Deleted' : 'Unchanged'}</span></td>
                    <td className="diff-source"><code>{line.text}</code>{line.ending === 'none' && <span className="diff-ending">No newline at end of file</span>}{line.ending === 'crlf' && <span className="diff-ending">CRLF</span>}{line.ending === 'cr' && <span className="diff-ending">CR</span>}</td>
                  </tr>)}
                </tbody>)}
              </table>
            </div>
          </> : <div className="changes-empty"><AlertCircle size={26} aria-hidden="true" /><h3>Preview unavailable for this file</h3>
            <p>{file.reason === 'protected_content' ? 'The preview was withheld because it may contain protected content.' : 'The file exceeds the preview size or complexity limit. Review the complete changes in the confirmed GitHub draft PR.'}</p></div>}
        </div>
      </div>
      <footer className="changes-footer"><span><GitBranch size={13} aria-hidden="true" />{data.branch}</span>
        <span title={data.base_sha}>Base {data.base_sha?.slice(0, 7)}<ChevronRight size={12} aria-hidden="true" />{data.commit_sha?.slice(0, 7)}</span></footer>
      <p className="changes-clipboard" role="status">{copyStatus}</p>
    </>}
  </section>
}
