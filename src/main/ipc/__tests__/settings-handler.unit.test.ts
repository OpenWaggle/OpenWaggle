import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  getSettingsMock,
  updateSettingsMock,
  providerRegistryGetMock,
  startChatStreamMock,
  createChatAdapterMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  providerRegistryGetMock: vi.fn(),
  startChatStreamMock: vi.fn(),
  createChatAdapterMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
}))

vi.mock('../../providers', () => ({
  providerRegistry: {
    get: providerRegistryGetMock,
  },
}))

vi.mock('../../adapters/tanstack-chat-adapter', () => ({
  startChatStream: startChatStreamMock,
}))

vi.mock('../../ports/chat-adapter-type', () => ({
  wrapChatAdapter: vi.fn((inner: unknown) => ({ _inner: inner })),
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { Layer } from 'effect'
import { ChatStreamError, ProviderLookupError } from '../../errors'
import { ChatService } from '../../ports/chat-service'
import { ProviderService } from '../../ports/provider-service'
import { SettingsService } from '../../services/settings-service'
import { registerSettingsHandlers } from '../settings-handler'

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.sync(() => getSettingsMock()),
  update: (partial) => Effect.sync(() => updateSettingsMock(partial)),
  transformMcpServers: () => Effect.void,
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: (providerId) => Effect.sync(() => providerRegistryGetMock(providerId)),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.succeed({} as never),
  isKnownModel: () => Effect.succeed(true),
  createChatAdapter: (model, apiKey, baseUrl, authMethod) =>
    Effect.try({
      try: () => createChatAdapterMock(model, apiKey, baseUrl, authMethod),
      catch: () => new ProviderLookupError({ modelId: model }),
    }),
  indexModels: () => Effect.void,
  fetchModels: () => Effect.succeed([]),
})

const TestChatServiceLayer = Layer.succeed(ChatService, {
  stream: () =>
    Effect.succeed(
      (async function* emptyStream() {
        /* empty */
      })(),
    ),
  testConnection: (options) =>
    Effect.tryPromise({
      try: async () => {
        const stream = startChatStreamMock({
          adapter: options.adapter,
          messages: [{ role: 'user', content: 'Hi' }],
        })
        for await (const chunk of stream) {
          if (chunk.type === 'RUN_ERROR') throw new Error(chunk.error.message)
          if (chunk.type === 'RUN_FINISHED') return
        }
        throw new Error('Connection closed before completion')
      },
      catch: (cause) =>
        new ChatStreamError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    }),
})

const TestLayer = Layer.mergeAll(TestSettingsLayer, TestProviderServiceLayer, TestChatServiceLayer)

function getTypedEffectInvokeHandler(
  name: string,
): ((...args: unknown[]) => Promise<unknown>) | undefined {
  const call = typedHandleMock.mock.calls.find(
    (candidate: readonly unknown[]) => candidate[0] === name && typeof candidate[1] === 'function',
  )
  const handler = call?.[1]
  if (typeof handler !== 'function') {
    return undefined
  }

  return (...args: unknown[]) => Effect.runPromise(Effect.provide(handler(...args), TestLayer))
}

describe('registerSettingsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    getSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    providerRegistryGetMock.mockReset()
    startChatStreamMock.mockReset()
    createChatAdapterMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerSettingsHandlers()

    const typedEffectChannels = typedHandleMock.mock.calls
      .map((call) => (typeof call[0] === 'string' ? call[0] : ''))
      .filter(Boolean)

    expect(typedEffectChannels).toContain('settings:get')
    expect(typedEffectChannels).toContain('settings:update')
    expect(typedEffectChannels).toContain('settings:test-api-key')
  })

  describe('settings:get', () => {
    it('returns the current settings', async () => {
      getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:get')
      expect(handler).toBeDefined()

      const result = await handler?.()
      expect(result).toEqual(DEFAULT_SETTINGS)
      expect(getSettingsMock).toHaveBeenCalledOnce()
    })
  })

  describe('settings:update', () => {
    it('validates and applies a valid settings update', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        executionMode: 'full-access',
        qualityPreset: 'high',
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          executionMode: 'full-access',
          qualityPreset: 'high',
        }),
      )
    })

    it('rejects an invalid settings payload and returns error', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        executionMode: 'invalid-mode',
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({
        ok: false,
        error: expect.any(String),
      })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('converts selectedModel string to SupportedModelId', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = { selectedModel: 'gpt-4.1-mini' }
      await handler?.({}, payload)

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      // The branded type is still a string at runtime
      expect(call.selectedModel).toBe('gpt-4.1-mini')
    })

    it('converts favoriteModels strings to SupportedModelId array', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        favoriteModels: ['claude-sonnet-4-5', 'gpt-4.1-mini'],
      }
      await handler?.({}, payload)

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.favoriteModels).toEqual(['claude-sonnet-4-5', 'gpt-4.1-mini'])
    })

    it('validates provider configs within the update', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        providers: {
          anthropic: { apiKey: 'sk-test-key', enabled: true },
        },
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })

    it('rejects invalid provider baseUrl', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        providers: {
          anthropic: {
            apiKey: 'sk-test',
            baseUrl: 'not-a-url',
            enabled: true,
          },
        },
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({
        ok: false,
        error: expect.any(String),
      })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('allows empty string baseUrl (coerced to undefined)', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        providers: {
          anthropic: { apiKey: 'sk-test', baseUrl: '', enabled: true },
        },
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })

    it('accepts projectPath as null', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = { projectPath: null }
      const result = await handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: null }),
      )
    })

    it('accepts skillTogglesByProject update', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        skillTogglesByProject: {
          '/tmp/repo': { 'skill-a': true, 'skill-b': false },
        },
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })
  })

  describe('settings:test-api-key', () => {
    it('returns error for unknown provider', async () => {
      providerRegistryGetMock.mockReturnValue(undefined)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      expect(handler).toBeDefined()

      const result = await handler?.({}, 'nonexistent', 'some-key')
      expect(result).toEqual({
        success: false,
        error: 'Unknown provider: nonexistent',
      })
    })

    it('returns success for provider that does not require API key and has no fetchModels', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'ollama',
        requiresApiKey: false,
      })
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '')
      expect(result).toEqual({ success: true })
    })

    it('tests connectivity for provider with fetchModels (success with models)', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'ollama',
        requiresApiKey: false,
        fetchModels: vi.fn().mockResolvedValue(['llama3', 'codellama']),
      })
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '', 'http://localhost:11434')
      expect(result).toEqual({ success: true })
    })

    it('returns success for keyless provider even when fetchModels returns empty list', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'ollama',
        requiresApiKey: false,
        fetchModels: vi.fn().mockResolvedValue([]),
      })
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '')
      expect(result).toEqual({ success: true })
    })

    it('returns success for keyless provider even when fetchModels throws', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'ollama',
        requiresApiKey: false,
        fetchModels: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      })
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '')
      expect(result).toEqual({ success: true })
    })

    it('tests API key by streaming a chat message (success path)', async () => {
      const mockAdapter = { id: 'mock-adapter' }
      createChatAdapterMock.mockReturnValue(mockAdapter)
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
        createAdapter: vi.fn().mockReturnValue(mockAdapter),
      })

      // Simulate an async iterable stream that yields RUN_FINISHED
      const streamChunks = [{ type: 'RUN_FINISHED', finishReason: 'stop' }]
      startChatStreamMock.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let index = 0
          return {
            next: async () => {
              if (index < streamChunks.length) {
                return { value: streamChunks[index++], done: false }
              }
              return { value: undefined, done: true }
            },
          }
        },
      })

      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'sk-ant-test-key')
      expect(result).toEqual({ success: true })
      expect(startChatStreamMock).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      )
    })

    it('tests API key and returns error when stream yields RUN_ERROR', async () => {
      createChatAdapterMock.mockReturnValue({})
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
      })

      const streamChunks = [
        {
          type: 'RUN_ERROR',
          error: { message: 'Invalid API key' },
        },
      ]
      startChatStreamMock.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let index = 0
          return {
            next: async () => {
              if (index < streamChunks.length) {
                return { value: streamChunks[index++], done: false }
              }
              return { value: undefined, done: true }
            },
          }
        },
      })

      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'bad-key')
      expect(result).toEqual({
        success: false,
        error: 'Invalid API key',
      })
    })

    it('returns error when stream closes without RUN_FINISHED or RUN_ERROR', async () => {
      createChatAdapterMock.mockReturnValue({})
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
      })

      // Stream that yields TEXT_MESSAGE_CONTENT but never finishes
      const streamChunks = [{ type: 'TEXT_MESSAGE_CONTENT', content: 'Hello' }]
      startChatStreamMock.mockReturnValue({
        [Symbol.asyncIterator]: () => {
          let index = 0
          return {
            next: async () => {
              if (index < streamChunks.length) {
                return { value: streamChunks[index++], done: false }
              }
              return { value: undefined, done: true }
            },
          }
        },
      })

      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'sk-key')
      expect(result).toEqual({
        success: false,
        error: 'Connection closed before completion',
      })
    })

    it('propagates adapter creation failures as ChatStreamError', async () => {
      createChatAdapterMock.mockImplementation(() => {
        throw new Error('Adapter creation failed')
      })
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
      })

      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      await expect(handler?.({}, 'anthropic', 'sk-key')).rejects.toThrow(/Failed to create adapter/)
    })

    it('passes baseUrl to createChatAdapter when provided', async () => {
      createChatAdapterMock.mockReturnValue({})
      providerRegistryGetMock.mockReturnValue({
        id: 'openai',
        requiresApiKey: true,
        testModel: 'gpt-4.1-mini',
      })

      startChatStreamMock.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({
            value: { type: 'RUN_FINISHED' },
            done: false,
          }),
        }),
      })

      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      await handler?.({}, 'openai', 'sk-key', 'https://custom.api.com')

      expect(createChatAdapterMock).toHaveBeenCalledWith(
        'gpt-4.1-mini',
        'sk-key',
        'https://custom.api.com',
        undefined,
      )
    })
  })
})
