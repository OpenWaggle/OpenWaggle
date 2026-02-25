import { describe, expect, it } from 'vitest'
import { openaiProvider } from './openai'

const INVALID_OPENAI_MODELS = ['gpt-5.3-codex', 'gpt-5.2-codex', 'gpt-5.1-codex-max'] as const

describe('openaiProvider model ids', () => {
  it('does not expose invalid model IDs', () => {
    const modelSet = new Set(openaiProvider.models)
    for (const model of INVALID_OPENAI_MODELS) {
      expect(modelSet.has(model)).toBe(false)
    }
  })

  it('rejects adapter creation for invalid model IDs', () => {
    for (const model of INVALID_OPENAI_MODELS) {
      expect(() => openaiProvider.createAdapter(model, 'sk-test')).toThrow(
        `Unknown OpenAI model: ${model}`,
      )
    }
  })
})
