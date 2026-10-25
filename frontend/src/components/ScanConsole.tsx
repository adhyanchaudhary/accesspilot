import { Terminal } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import type { AuditStatus } from '../lib/types'
import './ScanPanels.css'

type LineKind = 'command' | 'step' | 'done'
type LiveState = 'done' | 'active' | 'pending'

interface PreviewLine {
  kind: LineKind
  text: string
}

interface LiveLine {
  stage: number
  text: string
}

const STAGE_INDEX: Record<AuditStatus, number> = {
  queued: 0,
  scanning: 1,
  dispatching: 2,
  submitted: 3,
  failed: -1,
}

const MARKERS: Record<LineKind, string> = {
  command: '$',
  step: '›',
  done: '✓',
}

function markerFor(state: LiveState): ReactNode {
  if (state === 'done') return '✓'
  if (state === 'active') return <i className="scan-line-dot" aria-hidden="true" />
  return '○'
}

export function ScanConsole({
  websiteUrl,
  repoFullName,
  status,
}: {
  websiteUrl: string
  repoFullName: string | null
  status?: AuditStatus
}) {
  const url = websiteUrl.trim() || 'https://your-site.netlify.app'
  const repo = repoFullName || 'accesspilot-demo/storefront'
  const live = status !== undefined

  const previewLines: PreviewLine[] = [
    { kind: 'command', text: `accesspilot scan ${url}` },
    { kind: 'step', text: 'launching headless browser' },
    { kind: 'done', text: 'page rendered · DOM captured' },
    { kind: 'step', text: 'running axe-core · WCAG 2.2 AA' },
    { kind: 'done', text: 'violations grouped by impact' },
    { kind: 'step', text: `reading source from ${repo}` },
    { kind: 'step', text: 'generating minimal, reviewable fixes' },
    { kind: 'done', text: 'draft pull request ready for review' },
  ]

  const liveLines: LiveLine[] = [
    { stage: 0, text: 'audit queued · waiting for a scanner worker' },
    { stage: 1, text: 'launching headless browser' },
    { stage: 1, text: 'rendering page · capturing DOM' },
    { stage: 1, text: 'running axe-core · WCAG 2.2 AA' },
    { stage: 2, text: 'grouping violations by impact' },
    { stage: 2, text: 'counting affected elements' },
    { stage: 2, text: 'sending audit to the remediation workflow' },
    { stage: 3, text: `reading source from ${repo}` },
    { stage: 3, text: 'generating minimal, reviewable fixes' },
    { stage: 3, text: 'preparing the draft pull request' },
  ]

  const currentStage = status ? STAGE_INDEX[status] : -1
  const badge =
    status === 'submitted' ? 'Complete' : status === 'failed' ? 'Failed' : live ? 'Live' : 'Preview'

  return (
    <section
      className="card scan-console"
      aria-labelledby="scan-console-title"
      data-live={live ? 'true' : undefined}
      data-status={status}
    >
      <header className="scan-console-head">
        <div>
          <span className="scan-console-eyebrow">
            <Terminal className="h-3.5 w-3.5" aria-hidden="true" />
            Scan console
          </span>
          <h2 id="scan-console-title">
            {live ? 'Live scan console' : 'What a scan runs through'}
          </h2>
        </div>
        <span className={`scan-console-live${status === 'failed' ? ' scan-console-live-error' : ''}`}>
          <i aria-hidden="true" />
          {badge}
        </span>
      </header>

      <div className="scan-console-body">
        <ol aria-label={live ? 'Live scan progress' : 'Illustrative scan process'}>
          {live
            ? liveLines.map((line, index) => {
                const state: LiveState =
                  currentStage < 0
                    ? 'pending'
                    : line.stage < currentStage
                      ? 'done'
                      : line.stage === currentStage
                        ? 'active'
                        : 'pending'
                return (
                  <li
                    key={`${line.stage}-${index}`}
                    className={`scan-line scan-state-${state}`}
                    data-state={state}
                  >
                    <span className="scan-line-mark" aria-hidden="true">
                      {markerFor(state)}
                    </span>
                    <span>{line.text}</span>
                  </li>
                )
              })
            : previewLines.map((line, index) => (
                <li
                  key={`${line.kind}-${index}`}
                  className={`scan-line scan-line-${line.kind}`}
                  style={{ '--line': index } as CSSProperties}
                >
                  <span className="scan-line-mark" aria-hidden="true">
                    {MARKERS[line.kind]}
                  </span>
                  <span>{line.text}</span>
                </li>
              ))}
        </ol>
      </div>

      <p className="scan-console-note">
        {live
          ? 'Console updates as the backend reports each audit stage.'
          : 'Illustrative sequence — AccessPilot follows these steps after you start a scan.'}
      </p>
    </section>
  )
}
