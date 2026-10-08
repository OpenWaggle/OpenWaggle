import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({
  api: {},
}))

import { buildModelCatalogSet } from '../provider-store'

const PROVIDER_MODELS: ProviderInfo[] = [
  {
    provider: 'anthropic',
    displayName: 'Anthropic',

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
        id: SupportedModelId('anthropic/claude-sonnet-4-5'),
        modelId: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
      {
        id: SupportedModelId('anthropic/claude-opus-4-5'),
        modelId: 'claude-opus-4-5',
        name: 'Claude Opus 4.5',
        provider: 'anthropic',
        available: true,
        availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
      },
    ],
  },
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

describe('buildModelCatalogSet', () => {
  it('creates a set of canonical provider/modelId refs', () => {
    const catalog = buildModelCatalogSet(PROVIDER_MODELS)

    expect(catalog.has('anthropic/claude-sonnet-4-5')).toBe(true)
    expect(catalog.has('anthropic/claude-opus-4-5')).toBe(true)
    expect(catalog.has('openai/gpt-4.1-mini')).toBe(true)
    expect(catalog.has('gemini/gemini-2.5-flash')).toBe(false)
  })

  it('trims model IDs', () => {
    const models: ProviderInfo[] = [
      {
        ...PROVIDER_MODELS[0],
        models: [
          {
            id: SupportedModelId('  anthropic/claude-sonnet-4-5  '),
            modelId: 'claude-sonnet-4-5',
            name: 'Claude Sonnet 4.5',
            provider: 'anthropic',
            available: true,
            availableThinkingLevels: ['off', 'minimal', 'low', 'medium', 'high'],
          },
        ],
      },
    ]
    const catalog = buildModelCatalogSet(models)
    expect(catalog.has('anthropic/claude-sonnet-4-5')).toBe(true)
  })
})
