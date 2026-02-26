import type { SupportedModelId } from '@shared/types/llm'
import { describe, expect, it } from 'vitest'
import { anthropicProvider } from '../providers/anthropic'
import { openaiProvider } from '../providers/openai'
import type { ProviderDefinition } from '../providers/provider-definition'
import { isReasoningModel, resolveQualityConfig } from './quality-config'

/** Minimal provider stub — no resolveSampling (uses default passthrough) */
function stubProvider(id: ProviderDefinition['id'] = 'gemini'): ProviderDefinition {
  return {
    id,
    displayName: id,
    requiresApiKey: false,
    supportsBaseUrl: false,
    supportsSubscription: false,
    supportsDynamicModelFetch: false,
    models: [],
    testModel: '',
    createAdapter: () => ({}) as never,
  }
}

/** Provider stub using a real provider's resolveSampling */
function stubProviderFrom(real: ProviderDefinition): ProviderDefinition {
  return { ...stubProvider(real.id), resolveSampling: real.resolveSampling }
}

describe('resolveQualityConfig', () => {
  it('default passthrough returns base tier values for providers without resolveSampling', () => {
    const provider = stubProvider('gemini')
    const result = resolveQualityConfig(provider, 'gemini-2.5-flash' as SupportedModelId, 'medium')
    expect(result).toMatchObject({
      model: 'gemini-2.5-flash',
      temperature: 0.4,
      topP: 0.95,
      maxTokens: 2200,
    })
    expect(result.modelOptions).toBeUndefined()
  })

  it('returns deterministic base params for each preset', () => {
    const provider = stubProvider('gemini')

    expect(
      resolveQualityConfig(provider, 'gemini-2.5-flash' as SupportedModelId, 'low'),
    ).toMatchObject({
      temperature: 0.25,
      topP: 0.9,
      maxTokens: 1200,
    })
    expect(
      resolveQualityConfig(provider, 'gemini-2.5-flash' as SupportedModelId, 'medium'),
    ).toMatchObject({
      temperature: 0.4,
      topP: 0.95,
      maxTokens: 2200,
    })
    expect(
      resolveQualityConfig(provider, 'gemini-2.5-flash' as SupportedModelId, 'high'),
    ).toMatchObject({
      temperature: 0.55,
      topP: 1,
      maxTokens: 4200,
    })
  })

  it('never swaps the user model — model always equals input', () => {
    const provider = stubProviderFrom(anthropicProvider)
    const selected = 'claude-sonnet-4-5' as SupportedModelId
    expect(resolveQualityConfig(provider, selected, 'low').model).toBe(selected)
    expect(resolveQualityConfig(provider, selected, 'medium').model).toBe(selected)
    expect(resolveQualityConfig(provider, selected, 'high').model).toBe(selected)
  })

  describe('Anthropic resolveSampling', () => {
    const provider = stubProviderFrom(anthropicProvider)

    it('omits temperature and topP', () => {
      const result = resolveQualityConfig(
        provider,
        'claude-sonnet-4-5' as SupportedModelId,
        'medium',
      )
      expect(result.temperature).toBeUndefined()
      expect(result.topP).toBeUndefined()
    })

    it('sets thinking config per preset tier', () => {
      const low = resolveQualityConfig(provider, 'claude-sonnet-4-5' as SupportedModelId, 'low')
      expect(low.modelOptions).toEqual({ thinking: { type: 'enabled', budget_tokens: 1024 } })

      const medium = resolveQualityConfig(
        provider,
        'claude-sonnet-4-5' as SupportedModelId,
        'medium',
      )
      expect(medium.modelOptions).toEqual({ thinking: { type: 'enabled', budget_tokens: 4096 } })

      const high = resolveQualityConfig(provider, 'claude-sonnet-4-5' as SupportedModelId, 'high')
      expect(high.modelOptions).toEqual({ thinking: { type: 'enabled', budget_tokens: 10240 } })
    })

    it('sets larger thinking budgets for Opus per preset tier', () => {
      const opusLow = resolveQualityConfig(provider, 'claude-opus-4-6' as SupportedModelId, 'low')
      expect(opusLow.modelOptions).toEqual({ thinking: { type: 'enabled', budget_tokens: 2048 } })

      const opusMedium = resolveQualityConfig(
        provider,
        'claude-opus-4-6' as SupportedModelId,
        'medium',
      )
      expect(opusMedium.modelOptions).toEqual({
        thinking: { type: 'enabled', budget_tokens: 8192 },
      })

      const opusHigh = resolveQualityConfig(provider, 'claude-opus-4-6' as SupportedModelId, 'high')
      expect(opusHigh.modelOptions).toEqual({
        thinking: { type: 'enabled', budget_tokens: 16384 },
      })
    })

    it('floors maxTokens at 8192 for thinking budget', () => {
      expect(
        resolveQualityConfig(provider, 'claude-sonnet-4-5' as SupportedModelId, 'low').maxTokens,
      ).toBe(8192)
      expect(
        resolveQualityConfig(provider, 'claude-sonnet-4-5' as SupportedModelId, 'medium').maxTokens,
      ).toBe(8192)
      expect(
        resolveQualityConfig(provider, 'claude-sonnet-4-5' as SupportedModelId, 'high').maxTokens,
      ).toBe(8192)
    })
  })

  describe('OpenAI resolveSampling', () => {
    const provider = stubProviderFrom(openaiProvider)

    it('omits temperature and topP for reasoning models', () => {
      const result = resolveQualityConfig(provider, 'gpt-5' as SupportedModelId, 'medium')
      expect(result.temperature).toBeUndefined()
      expect(result.topP).toBeUndefined()
    })

    it('reasoning effort equals preset directly', () => {
      const low = resolveQualityConfig(provider, 'gpt-5' as SupportedModelId, 'low')
      expect(low.modelOptions).toEqual({ reasoning: { effort: 'low', summary: 'auto' } })

      const medium = resolveQualityConfig(provider, 'gpt-5' as SupportedModelId, 'medium')
      expect(medium.modelOptions).toEqual({ reasoning: { effort: 'medium', summary: 'auto' } })

      const high = resolveQualityConfig(provider, 'gpt-5' as SupportedModelId, 'high')
      expect(high.modelOptions).toEqual({ reasoning: { effort: 'high', summary: 'auto' } })
    })

    it('multiplies maxTokens by 4 for reasoning models', () => {
      expect(resolveQualityConfig(provider, 'gpt-5' as SupportedModelId, 'medium').maxTokens).toBe(
        2200 * 4,
      )
      expect(
        resolveQualityConfig(provider, 'gpt-5-mini' as SupportedModelId, 'low').maxTokens,
      ).toBe(1200 * 4)
    })

    it('passes through base values for non-reasoning models', () => {
      const result = resolveQualityConfig(provider, 'gpt-4.1' as SupportedModelId, 'medium')
      expect(result.temperature).toBe(0.4)
      expect(result.topP).toBe(0.95)
      expect(result.maxTokens).toBe(2200)
      expect(result.modelOptions).toBeUndefined()
    })
  })

  describe('project overrides', () => {
    const provider = stubProvider('gemini')

    it('merges project overrides with app defaults', () => {
      const result = resolveQualityConfig(
        provider,
        'gemini-2.5-flash' as SupportedModelId,
        'medium',
        { medium: { temperature: 0.7, maxTokens: 5000 } },
      )
      expect(result.temperature).toBe(0.7)
      expect(result.topP).toBe(0.95) // from app default
      expect(result.maxTokens).toBe(5000)
    })

    it('provider constraints still apply on top of project overrides', () => {
      const anthropic = stubProviderFrom(anthropicProvider)
      const result = resolveQualityConfig(
        anthropic,
        'claude-sonnet-4-5' as SupportedModelId,
        'medium',
        { medium: { temperature: 0.8 } },
      )
      // Anthropic resolveSampling forces temperature to undefined
      expect(result.temperature).toBeUndefined()
    })

    it('ignores undefined override tiers', () => {
      const result = resolveQualityConfig(
        provider,
        'gemini-2.5-flash' as SupportedModelId,
        'low',
        { medium: { temperature: 0.9 } }, // only medium overridden
      )
      expect(result.temperature).toBe(0.25) // low uses app default
    })
  })
})

describe('isReasoningModel', () => {
  it('identifies GPT-5 variants as reasoning models', () => {
    expect(isReasoningModel('gpt-5')).toBe(true)
    expect(isReasoningModel('gpt-5-mini')).toBe(true)
    expect(isReasoningModel('gpt-5.2')).toBe(true)
  })

  it('identifies o-series as reasoning models', () => {
    expect(isReasoningModel('o1')).toBe(true)
    expect(isReasoningModel('o3')).toBe(true)
    expect(isReasoningModel('o4-mini')).toBe(true)
  })

  it('rejects non-reasoning models', () => {
    expect(isReasoningModel('gpt-4.1')).toBe(false)
    expect(isReasoningModel('claude-sonnet-4-5')).toBe(false)
    expect(isReasoningModel('gemini-2.5-flash')).toBe(false)
  })
})
