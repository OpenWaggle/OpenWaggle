import { Layer } from 'effect'
import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type ProviderCapabilities,
  type ProviderModelCapabilities,
  ProviderService,
} from '../../ports/provider-service'

const { typedHandleMock, getAllMock, getMock } = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  getAllMock: vi.fn(),
  getMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

function makeModel(id: string): ProviderModelCapabilities {
  return {
    id: `openai/${id}`,
    modelId: id,
    available: true,
    reasoning: false,
    availableThinkingLevels: ['off'],
    input: ['text'],
    contextWindow: 1_000_000,
    maxTokens: 32_768,
  }
}

const fallbackProvider: ProviderCapabilities = {
  id: 'openai',
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
  models: [makeModel('gpt-4.1-mini')],
  testModel: 'gpt-4.1-mini',
}

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: (providerId) => Effect.sync(() => getMock(providerId)),
  getAll: () => Effect.sync(() => getAllMock()),
  getProviderForModel: () => Effect.succeed(fallbackProvider),
  isKnownModel: () => Effect.succeed(true),
})

import { registerProvidersHandlers } from '../providers-handler'

function registeredHandler(name: string): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }
  return (...args: unknown[]) =>
    Effect.runPromise(Effect.provide(handler(...args), TestProviderServiceLayer))
}

describe('registerProvidersHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    getAllMock.mockReset()
    getMock.mockReset()
  })

  it('registers providers:get-models and returns mapped display info', async () => {
    getAllMock.mockReturnValue([
      {
        id: 'openai',
        displayName: 'OpenAI',
        apiKeyManagementUrl: 'https://platform.openai.com/api-keys',

        auth: {
          configured: true,
          source: 'api-key',
          apiKeyConfigured: true,
          apiKeySource: 'api-key',
          oauthConnected: false,
          supportsApiKey: true,
          supportsOAuth: true,
        },
        models: [makeModel('gpt-4.1-mini')],
      },
    ])

    registerProvidersHandlers()
    const handler = registeredHandler('providers:get-models')

    expect(handler).toBeDefined()
    const result = await handler?.()
    expect(result).toEqual([
      {
        provider: 'openai',
        displayName: 'OpenAI',
        apiKeyManagementUrl: 'https://platform.openai.com/api-keys',

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
            id: 'openai/gpt-4.1-mini',
            modelId: 'gpt-4.1-mini',
            name: 'GPT 4.1 Mini',
            provider: 'openai',
            available: true,
            availableThinkingLevels: ['off'],
            contextWindow: 1_000_000,
          },
        ],
      },
    ])
  })
})
