import { describe, expect, it } from 'vitest'
import { isReasoningModel } from '../model-classification'

describe('isReasoningModel', () => {
  it.each([
    ['gpt-5', true],
    ['gpt-5-mini', true],
    ['gpt-5-turbo', true],
    ['o1', true],
    ['o1-mini', true],
    ['o1-preview', true],
    ['o3', true],
    ['o3-mini', true],
    ['o4-mini', true],
  ])('returns true for reasoning model "%s"', (model, expected) => {
    expect(isReasoningModel(model)).toBe(expected)
  })

  it.each([
    ['gpt-4.1', false],
    ['gpt-4.1-mini', false],
    ['gpt-4o', false],
    ['claude-sonnet-4-5', false],
    ['claude-3-opus', false],
    ['gemini-2.5-flash', false],
    ['gemini-2.5-pro', false],
    ['', false],
    ['o', false],
    ['random-model', false],
  ])('returns false for non-reasoning model "%s"', (model, expected) => {
    expect(isReasoningModel(model)).toBe(expected)
  })
})
