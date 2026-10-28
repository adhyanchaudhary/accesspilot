import rules from '../data/axe-rules.json'

type RuleExplanation = { title: string; why: string; suggestion: string }

export function explainRule(id: string, description?: string): RuleExplanation {
  if (Object.prototype.hasOwnProperty.call(rules, id)) {
    return (rules as Record<string, RuleExplanation>)[id]
  }
  return {
    title: 'Accessibility issue needs review',
    why: description || 'Review the original finding and affected element for details.',
    suggestion: 'Review the proposed code alongside the original finding before accepting it.',
  }
}
