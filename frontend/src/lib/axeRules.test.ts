import { expect, it } from 'vitest'
import { explainRule } from './axeRules'

it('uses original descriptions for unknown rules, including object property names', () => {
  for (const id of ['new-rule', 'constructor', '__proto__']) {
    expect(explainRule(id, 'Original evidence').why).toBe('Original evidence')
  }
})
