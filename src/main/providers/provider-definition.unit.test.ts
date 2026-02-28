import { describe, expect, it } from 'vitest'
import { defaultResolveSampling } from './provider-definition'

describe('defaultResolveSampling', () => {
  it('passes through base config unchanged', () => {
    const base = { temperature: 0.7, topP: 0.9, maxTokens: 4096 }
    const result = defaultResolveSampling('any-model', 'medium', base)
    expect(result).toEqual({
      temperature: 0.7,
      topP: 0.9,
      maxTokens: 4096,
    })
  })

  it('works for all quality presets', () => {
    const base = { temperature: 0.3, topP: 0.5, maxTokens: 2048 }
    for (const preset of ['low', 'medium', 'high'] as const) {
      const result = defaultResolveSampling('model', preset, base)
      expect(result.temperature).toBe(0.3)
      expect(result.topP).toBe(0.5)
      expect(result.maxTokens).toBe(2048)
    }
  })
})
