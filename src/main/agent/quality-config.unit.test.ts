import type { SupportedModelId } from '@shared/types/llm'
import { describe, expect, it } from 'vitest'
import { resolveQualityConfig } from './quality-config'

describe('resolveQualityConfig', () => {
  it('returns curated model mappings for providers with preset maps', () => {
    expect(resolveQualityConfig('openai', 'gpt-5-mini' as SupportedModelId, 'low').model).toBe(
      'gpt-5-mini',
    )
    expect(resolveQualityConfig('openai', 'gpt-5-mini' as SupportedModelId, 'medium').model).toBe(
      'gpt-5',
    )
    expect(resolveQualityConfig('openai', 'gpt-5-mini' as SupportedModelId, 'high').model).toBe(
      'gpt-5.2',
    )

    expect(
      resolveQualityConfig('anthropic', 'claude-sonnet-4-5' as SupportedModelId, 'high').model,
    ).toBe('claude-opus-4-6')
  })

  it('falls back to selected model when provider has no curated mapping', () => {
    const selected = 'llama3.1:8b' as SupportedModelId
    expect(resolveQualityConfig('ollama', selected, 'low').model).toBe(selected)
    expect(resolveQualityConfig('ollama', selected, 'medium').model).toBe(selected)
    expect(resolveQualityConfig('ollama', selected, 'high').model).toBe(selected)
  })

  it('returns deterministic generation params for each preset', () => {
    expect(
      resolveQualityConfig('gemini', 'gemini-2.5-flash' as SupportedModelId, 'low'),
    ).toMatchObject({
      temperature: 0.25,
      topP: 0.9,
      maxTokens: 1200,
    })

    expect(
      resolveQualityConfig('gemini', 'gemini-2.5-flash' as SupportedModelId, 'medium'),
    ).toMatchObject({
      temperature: 0.4,
      topP: 0.95,
      maxTokens: 2200,
    })

    expect(
      resolveQualityConfig('gemini', 'gemini-2.5-flash' as SupportedModelId, 'high'),
    ).toMatchObject({
      temperature: 0.55,
      topP: 1,
      maxTokens: 4200,
    })
  })

  it('omits topP for anthropic to avoid conflicting sampling params', () => {
    const resolved = resolveQualityConfig(
      'anthropic',
      'claude-sonnet-4-5' as SupportedModelId,
      'medium',
    )
    expect(resolved.temperature).toBe(0.4)
    expect(resolved.topP).toBeUndefined()
  })
})
