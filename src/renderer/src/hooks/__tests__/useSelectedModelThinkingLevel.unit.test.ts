import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/ipc', () => ({
  api: {},
}))

import { resolveSelectedModelThinkingLevel } from '../useSelectedModelThinkingLevel'

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'openai',
    displayName: 'OpenAI',
    auth: {
      configured: true,
      source: 'api-key',
      apiKeyConfigured: true,
      apiKeySource: 'api-key',
      oauthConnected: false,
      supportsApiKey: true,
      supportsOAuth: true,
    },
    models: [
      {
        id: SupportedModelId('openai/gpt-5.4'),
        modelId: 'gpt-5.4',
        name: 'GPT 5.4',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      },
      {
        id: SupportedModelId('openai/gpt-5'),
        modelId: 'gpt-5',
        name: 'GPT 5',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
      {
        id: SupportedModelId('openai/gpt-4.1-mini'),
        modelId: 'gpt-4.1-mini',
        name: 'GPT 4.1 Mini',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['off'],
      },
    ],
  },
]

describe('resolveSelectedModelThinkingLevel', () => {
  it('keeps xhigh for models that expose xhigh', () => {
    const result = resolveSelectedModelThinkingLevel({
      providerModels: PROVIDER_MODELS,
      selectedModel: SupportedModelId('openai/gpt-5.4'),
      requestedThinkingLevel: 'xhigh',
    })

    expect(result.effectiveThinkingLevel).toBe('xhigh')
    expect(result.isAdjustedForModel).toBe(false)
  })

  it('maps xhigh to high when the selected model does not expose xhigh', () => {
    const result = resolveSelectedModelThinkingLevel({
      providerModels: PROVIDER_MODELS,
      selectedModel: SupportedModelId('openai/gpt-5'),
      requestedThinkingLevel: 'xhigh',
    })

    expect(result.effectiveThinkingLevel).toBe('high')
    expect(result.isAdjustedForModel).toBe(true)
  })

  it('maps reasoning requests to off for non-reasoning selected models', () => {
    const result = resolveSelectedModelThinkingLevel({
      providerModels: PROVIDER_MODELS,
      selectedModel: SupportedModelId('openai/gpt-4.1-mini'),
      requestedThinkingLevel: 'medium',
    })

    expect(result.effectiveThinkingLevel).toBe('off')
    expect(result.availableThinkingLevels).toEqual(['off'])
    expect(result.isAdjustedForModel).toBe(true)
  })

  it('keeps the requested value while model capabilities are still unknown', () => {
    const result = resolveSelectedModelThinkingLevel({
      providerModels: [],
      selectedModel: SupportedModelId('openai/gpt-5'),
      requestedThinkingLevel: 'medium',
    })

    expect(result.capabilitiesKnown).toBe(false)
    expect(result.effectiveThinkingLevel).toBe('medium')
    expect(result.availableThinkingLevels).toEqual([])
  })
})
