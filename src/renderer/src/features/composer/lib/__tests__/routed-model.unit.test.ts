import { SupportedModelId } from '@shared/types/brand'
import type { ProviderInfo } from '@shared/types/llm'
import { describe, expect, it } from 'vitest'
import { lastAnsweringModel, routedModelName } from '../routed-model'

const providers: ProviderInfo[] = [
  {
    provider: 'router',
    displayName: 'router',
    auth: {
      configured: true,
      source: 'none',
      apiKeyConfigured: false,
      apiKeySource: 'none',
      oauthConnected: false,
      supportsApiKey: false,
      supportsOAuth: false,
    },
    models: [
      {
        id: SupportedModelId('router/auto'),
        modelId: 'auto',
        name: 'Auto',
        provider: 'router',
        available: true,
        availableThinkingLevels: ['low', 'high'],
        virtual: true,
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
        id: SupportedModelId('openai/gpt-6-luna'),
        modelId: 'gpt-6-luna',
        name: 'GPT-6 Luna',
        provider: 'openai',
        available: true,
        availableThinkingLevels: ['medium'],
        contextWindow: 400_000,
      },
    ],
  },
]

describe('routedModelName', () => {
  it('names the physical model a virtual selection last routed to', () => {
    expect(
      routedModelName({
        selected: SupportedModelId('router/auto'),
        answeredBy: SupportedModelId('openai/gpt-6-luna'),
        providerModels: providers,
      }),
    ).toBe('GPT-6 Luna')
  })

  it('names nothing for a physical selection, or before the virtual model has answered', () => {
    expect(
      routedModelName({
        selected: SupportedModelId('openai/gpt-6-luna'),
        answeredBy: SupportedModelId('openai/gpt-6-luna'),
        providerModels: providers,
      }),
    ).toBeNull()
    expect(
      routedModelName({
        selected: SupportedModelId('router/auto'),
        answeredBy: undefined,
        providerModels: providers,
      }),
    ).toBeNull()
  })

  it('falls back to the model id when the catalog does not list the answering model', () => {
    expect(
      routedModelName({
        selected: SupportedModelId('router/auto'),
        answeredBy: SupportedModelId('anthropic/claude-haiku-4-5'),
        providerModels: providers,
      }),
    ).toBe('claude-haiku-4-5')
  })
})

describe('lastAnsweringModel', () => {
  it('reads the model of the latest assistant message', () => {
    expect(
      lastAnsweringModel([
        { role: 'assistant', model: SupportedModelId('openai/gpt-6-sol') },
        { role: 'user' },
        { role: 'assistant', model: SupportedModelId('openai/gpt-6-luna') },
        { role: 'user' },
      ]),
    ).toBe('openai/gpt-6-luna')
  })
})
