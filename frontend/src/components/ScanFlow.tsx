import { Github, GitPullRequest, ScanSearch, Sparkles, type LucideIcon } from 'lucide-react'
import './ScanPanels.css'

interface FlowStep {
  icon: LucideIcon
  tone: 'blue' | 'violet' | 'amber' | 'green'
  title: string
  description: string
}

const STEPS: FlowStep[] = [
  {
    icon: Github,
    tone: 'blue',
    title: 'Connect the source',
    description: 'Choose an authorized repository so fixes land in the right codebase.',
  },
  {
    icon: ScanSearch,
    tone: 'violet',
    title: 'Scan the website',
    description: 'A headless browser renders the page and runs the axe-core audit.',
  },
  {
    icon: Sparkles,
    tone: 'amber',
    title: 'Prepare the patch',
    description: 'The AI workflow drafts minimal fixes for each confirmed violation.',
  },
  {
    icon: GitPullRequest,
    tone: 'green',
    title: 'Review the PR',
    description: 'A draft pull request appears in GitHub for human review before merge.',
  },
]

export function ScanFlow() {
  return (
    <section className="card scan-flow" aria-labelledby="scan-flow-title">
      <div className="scan-flow-head">
        <div>
          <span className="scan-flow-eyebrow">What happens next</span>
          <h2 id="scan-flow-title">From URL to reviewed pull request</h2>
          <p>
            One clear path from the deployed site to a draft pull request you control.
          </p>
        </div>
        <span className="scan-flow-tag">4 steps · human approved</span>
      </div>

      <ol className="scan-flow-track" aria-label="AccessPilot scan workflow">
        {STEPS.map((step, index) => {
          const Icon = step.icon
          return (
            <li key={step.title} className="scan-flow-step" data-tone={step.tone}>
              <span className="scan-flow-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="scan-flow-index">Step {String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
