import type { SupportedModelId } from '@shared/types/llm'
import { describe, expect, it } from 'vitest'
import { isReasoningModel, resolveQualityConfig } from './quality-config'

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

  it('omits temperature and topP for reasoning models (GPT-5, o-series)', () => {
    const gpt5 = resolveQualityConfig('openai', 'gpt-5' as SupportedModelId, 'medium')
    expect(gpt5.temperature).toBeUndefined()
    expect(gpt5.topP).toBeUndefined()

    const gpt5Mini = resolveQualityConfig('openai', 'gpt-5-mini' as SupportedModelId, 'low')
    expect(gpt5Mini.temperature).toBeUndefined()

    const gpt52 = resolveQualityConfig('openai', 'gpt-5.2' as SupportedModelId, 'high')
    expect(gpt52.temperature).toBeUndefined()
  })

  it('multiplies maxTokens for OpenAI reasoning models', () => {
    const gpt5 = resolveQualityConfig('openai', 'gpt-5' as SupportedModelId, 'medium')
    // base medium maxTokens is 2200, reasoning multiplier is 4x
    expect(gpt5.maxTokens).toBe(2200 * 4)

    const gpt5Low = resolveQualityConfig('openai', 'gpt-5-mini' as SupportedModelId, 'low')
    expect(gpt5Low.maxTokens).toBe(1200 * 4)
  })

  it('sets reasoning modelOptions for OpenAI reasoning models', () => {
    const gpt5Medium = resolveQualityConfig('openai', 'gpt-5' as SupportedModelId, 'medium')
    expect(gpt5Medium.modelOptions).toEqual({
      reasoning: { effort: 'medium', summary: 'auto' },
    })

    const gpt5Low = resolveQualityConfig('openai', 'gpt-5-mini' as SupportedModelId, 'low')
    expect(gpt5Low.modelOptions).toEqual({
      reasoning: { effort: 'low', summary: 'auto' },
    })
  })

  it('sets thinking modelOptions for Anthropic models', () => {
    const sonnet = resolveQualityConfig(
      'anthropic',
      'claude-sonnet-4-5' as SupportedModelId,
      'medium',
    )
    expect(sonnet.modelOptions).toEqual({
      thinking: { type: 'enabled', budget_tokens: 4096 },
    })

    const sonnetLow = resolveQualityConfig(
      'anthropic',
      'claude-sonnet-4-5' as SupportedModelId,
      'low',
    )
    expect(sonnetLow.modelOptions).toEqual({
      thinking: { type: 'enabled', budget_tokens: 1024 },
    })
  })

  it('sets adaptive thinking for Anthropic Opus models', () => {
    // high preset maps to claude-opus-4-6
    const opusHigh = resolveQualityConfig(
      'anthropic',
      'claude-opus-4-6' as SupportedModelId,
      'high',
    )
    expect(opusHigh.modelOptions).toEqual({
      thinking: { type: 'adaptive' },
      effort: 'medium',
    })

    // medium preset maps to claude-sonnet-4-5, so not opus → enabled thinking
    const opusMedium = resolveQualityConfig(
      'anthropic',
      'claude-opus-4-6' as SupportedModelId,
      'medium',
    )
    expect(opusMedium.modelOptions).toEqual({
      thinking: { type: 'enabled', budget_tokens: 4096 },
    })
  })

  it('floors Anthropic maxTokens at 8192 for thinking budget', () => {
    const sonnetLow = resolveQualityConfig(
      'anthropic',
      'claude-sonnet-4-5' as SupportedModelId,
      'low',
    )
    // base low maxTokens is 1200, floored to 8192
    expect(sonnetLow.maxTokens).toBe(8192)

    const sonnetMedium = resolveQualityConfig(
      'anthropic',
      'claude-sonnet-4-5' as SupportedModelId,
      'medium',
    )
    expect(sonnetMedium.maxTokens).toBe(8192)
  })

  it('does not add modelOptions for non-reasoning providers', () => {
    const gemini = resolveQualityConfig('gemini', 'gemini-2.5-flash' as SupportedModelId, 'medium')
    expect(gemini.modelOptions).toBeUndefined()

    const ollama = resolveQualityConfig('ollama', 'llama3.1:8b' as SupportedModelId, 'medium')
    expect(ollama.modelOptions).toBeUndefined()
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
