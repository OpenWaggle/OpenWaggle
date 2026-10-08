import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/shared/lib/ipc', () => ({
  api: {},
}))

import { buildModelCatalogSet, isSelectableModel, modelUnavailableMessage } from '../provider-store'

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

describe("a Session's model that is not enabled in OpenWaggle", () => {
  const SONNET = SupportedModelId('anthropic/claude-sonnet-4-5')

  it('can be used when Pi can run it, as `pi --resume` does', () => {
    expect(isSelectableModel(PROVIDER_MODELS, SONNET, true)).toBe(true)
  })

  it('names the provider to sign in to when Pi has the model but no sign-in', () => {
    const signedOut = PROVIDER_MODELS.map((group) => ({
      ...group,
      models: group.models.map((model) => ({ ...model, available: false })),
    }))

    expect(isSelectableModel(signedOut, SONNET, true)).toBe(false)
    expect(modelUnavailableMessage(signedOut, SONNET)).toBe(
      'Claude Sonnet 4.5 needs a sign-in to Anthropic. Connect Anthropic in Settings > Connections, or choose another model.',
    )
  })

  it('names a model Pi does not know', () => {
    const missing = SupportedModelId('qa-faux/luna')

    expect(isSelectableModel(PROVIDER_MODELS, missing, true)).toBe(false)
    expect(modelUnavailableMessage(PROVIDER_MODELS, missing)).toBe(
      'qa-faux/luna is not available in this project. Add its provider in Settings > Connections, or choose another model.',
    )
  })

  it('asks for a model when there is none', () => {
    expect(modelUnavailableMessage(PROVIDER_MODELS, undefined)).toBe(
      'Select a model before sending.',
    )
  })
})
