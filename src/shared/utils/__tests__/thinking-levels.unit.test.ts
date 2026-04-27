import { describe, expect, it } from 'vitest'
import { clampThinkingLevel } from '../thinking-levels'

describe('clampThinkingLevel', () => {
  it('keeps a requested level that is available', () => {
    expect(clampThinkingLevel('medium', ['off', 'minimal', 'low', 'medium', 'high'])).toBe('medium')
  })

  it('clamps unsupported xhigh to the nearest lower available level', () => {
    expect(clampThinkingLevel('xhigh', ['off', 'minimal', 'low', 'medium', 'high'])).toBe('high')
  })

  it('clamps reasoning requests to off when the selected model has no reasoning levels', () => {
    expect(clampThinkingLevel('medium', ['off'])).toBe('off')
  })

  it('falls back to off if no available levels are supplied', () => {
    expect(clampThinkingLevel('high', [])).toBe('off')
  })
})
