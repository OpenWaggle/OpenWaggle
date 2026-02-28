import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  safeHandleMock,
  getSettingsMock,
  updateSettingsMock,
  providerRegistryGetMock,
  chatMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  safeHandleMock: vi.fn(),
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  providerRegistryGetMock: vi.fn(),
  chatMock: vi.fn(),
}))

vi.mock('./typed-ipc', () => ({
  typedHandle: typedHandleMock,
  safeHandle: safeHandleMock,
}))

vi.mock('../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
}))

vi.mock('../providers', () => ({
  providerRegistry: {
    get: providerRegistryGetMock,
  },
}))

vi.mock('@tanstack/ai', () => ({
  chat: chatMock,
}))

vi.mock('../logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import { DEFAULT_SETTINGS } from '@shared/types/settings'
import { registerSettingsHandlers } from './settings-handler'

function getTypedInvokeHandler(name: string): ((...args: unknown[]) => unknown) | undefined {
  const call = typedHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
  return call?.[1] as ((...args: unknown[]) => unknown) | undefined
}

function getSafeInvokeHandler(name: string): ((...args: unknown[]) => unknown) | undefined {
  const call = safeHandleMock.mock.calls.find((c: unknown[]) => c[0] === name)
  return call?.[1] as ((...args: unknown[]) => unknown) | undefined
}

describe('registerSettingsHandlers', () => {
  beforeEach(() => {
    typedHandleMock.mockReset()
    safeHandleMock.mockReset()
    getSettingsMock.mockReset()
    updateSettingsMock.mockReset()
    providerRegistryGetMock.mockReset()
    chatMock.mockReset()
  })

  it('registers all expected IPC channels', () => {
    registerSettingsHandlers()

    const typedChannels = typedHandleMock.mock.calls.map((c: unknown[]) => c[0] as string)
    const safeChannels = safeHandleMock.mock.calls.map((c: unknown[]) => c[0] as string)

    expect(typedChannels).toContain('settings:get')
    expect(typedChannels).toContain('settings:test-api-key')
    expect(safeChannels).toContain('settings:update')
  })

  describe('settings:get', () => {
    it('returns the current settings', () => {
      getSettingsMock.mockReturnValue(DEFAULT_SETTINGS)
      registerSettingsHandlers()

      const handler = getTypedInvokeHandler('settings:get')
      expect(handler).toBeDefined()

      const result = handler?.()
      expect(result).toEqual(DEFAULT_SETTINGS)
      expect(getSettingsMock).toHaveBeenCalledOnce()
    })
  })

  describe('settings:update', () => {
    it('validates and applies a valid settings update', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        executionMode: 'full-access',
        qualityPreset: 'high',
      }
      const result = handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          executionMode: 'full-access',
          qualityPreset: 'high',
        }),
      )
    })

    it('rejects an invalid settings payload and returns error', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        executionMode: 'invalid-mode',
      }
      const result = handler?.({}, payload)
      expect(result).toEqual({
        ok: false,
        error: expect.any(String),
      })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('converts defaultModel string to SupportedModelId', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = { defaultModel: 'gpt-4.1-mini' }
      handler?.({}, payload)

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      // The branded type is still a string at runtime
      expect(call.defaultModel).toBe('gpt-4.1-mini')
    })

    it('converts favoriteModels strings to SupportedModelId array', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        favoriteModels: ['claude-sonnet-4-5', 'gpt-4.1-mini'],
      }
      handler?.({}, payload)

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.favoriteModels).toEqual(['claude-sonnet-4-5', 'gpt-4.1-mini'])
    })

    it('validates provider configs within the update', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      // z.record(z.enum(PROVIDERS), ...) requires all enum keys to be present
      const payload = {
        providers: {
          anthropic: { apiKey: 'sk-test-key', enabled: true },
          openai: { apiKey: '', enabled: false },
          gemini: { apiKey: '', enabled: false },
          grok: { apiKey: '', enabled: false },
          openrouter: { apiKey: '', enabled: false },
          ollama: { apiKey: '', enabled: false },
        },
      }
      const result = handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })

    it('rejects invalid provider baseUrl', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
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
      const result = handler?.({}, payload)
      expect(result).toEqual({
        ok: false,
        error: expect.any(String),
      })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('allows empty string baseUrl (coerced to undefined)', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        providers: {
          anthropic: { apiKey: 'sk-test', baseUrl: '', enabled: true },
          openai: { apiKey: '', enabled: false },
          gemini: { apiKey: '', enabled: false },
          grok: { apiKey: '', enabled: false },
          openrouter: { apiKey: '', enabled: false },
          ollama: { apiKey: '', enabled: false },
        },
      }
      const result = handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })

    it('accepts valid orchestrationMode update', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = { orchestrationMode: 'classic' }
      const result = handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ orchestrationMode: 'classic' }),
      )
    })

    it('accepts projectPath as null', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = { projectPath: null }
      const result = handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({ projectPath: null }),
      )
    })

    it('accepts skillTogglesByProject update', () => {
      registerSettingsHandlers()

      const handler = getSafeInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        skillTogglesByProject: {
          '/tmp/repo': { 'skill-a': true, 'skill-b': false },
        },
      }
      const result = handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
    })
  })

  describe('settings:test-api-key', () => {
    it('returns error for unknown provider', async () => {
      providerRegistryGetMock.mockReturnValue(undefined)
      registerSettingsHandlers()

      const handler = getTypedInvokeHandler('settings:test-api-key')
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

      const handler = getTypedInvokeHandler('settings:test-api-key')
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

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '', 'http://localhost:11434')
      expect(result).toEqual({ success: true })
    })

    it('returns error when fetchModels returns empty list', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'ollama',
        requiresApiKey: false,
        fetchModels: vi.fn().mockResolvedValue([]),
      })
      registerSettingsHandlers()

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '')
      expect(result).toEqual({
        success: false,
        error: 'No models found — is the service running?',
      })
    })

    it('returns error when fetchModels throws', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'ollama',
        requiresApiKey: false,
        fetchModels: vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
      })
      registerSettingsHandlers()

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '')
      expect(result).toEqual({
        success: false,
        error: 'ECONNREFUSED',
      })
    })

    it('tests API key by streaming a chat message (success path)', async () => {
      const mockAdapter = { id: 'mock-adapter' }
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
        createAdapter: vi.fn().mockReturnValue(mockAdapter),
      })

      // Simulate an async iterable stream that yields RUN_FINISHED
      const streamChunks = [{ type: 'RUN_FINISHED', finishReason: 'stop' }]
      chatMock.mockReturnValue({
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

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'sk-ant-test-key')
      expect(result).toEqual({ success: true })
      expect(chatMock).toHaveBeenCalledWith(
        expect.objectContaining({
          adapter: mockAdapter,
          messages: [{ role: 'user', content: 'Hi' }],
        }),
      )
    })

    it('tests API key and returns error when stream yields RUN_ERROR', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
        createAdapter: vi.fn().mockReturnValue({}),
      })

      const streamChunks = [
        {
          type: 'RUN_ERROR',
          error: { message: 'Invalid API key' },
        },
      ]
      chatMock.mockReturnValue({
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

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'bad-key')
      expect(result).toEqual({
        success: false,
        error: 'Invalid API key',
      })
    })

    it('returns error when stream closes without RUN_FINISHED or RUN_ERROR', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
        createAdapter: vi.fn().mockReturnValue({}),
      })

      // Stream that yields TEXT_MESSAGE_CONTENT but never finishes
      const streamChunks = [{ type: 'TEXT_MESSAGE_CONTENT', content: 'Hello' }]
      chatMock.mockReturnValue({
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

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'sk-key')
      expect(result).toEqual({
        success: false,
        error: 'Connection closed before completion',
      })
    })

    it('catches errors thrown during chat and returns them', async () => {
      providerRegistryGetMock.mockReturnValue({
        id: 'anthropic',
        requiresApiKey: true,
        testModel: 'claude-haiku-3.5',
        createAdapter: vi.fn().mockImplementation(() => {
          throw new Error('Adapter creation failed')
        }),
      })

      registerSettingsHandlers()

      const handler = getTypedInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'sk-key')
      expect(result).toEqual({
        success: false,
        error: 'Adapter creation failed',
      })
    })

    it('passes baseUrl to createAdapter when provided', async () => {
      const createAdapterMock = vi.fn().mockReturnValue({})
      providerRegistryGetMock.mockReturnValue({
        id: 'openai',
        requiresApiKey: true,
        testModel: 'gpt-4.1-mini',
        createAdapter: createAdapterMock,
      })

      chatMock.mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: async () => ({
            value: { type: 'RUN_FINISHED' },
            done: false,
          }),
        }),
      })

      registerSettingsHandlers()

      const handler = getTypedInvokeHandler('settings:test-api-key')
      await handler?.({}, 'openai', 'sk-key', 'https://custom.api.com')

      expect(createAdapterMock).toHaveBeenCalledWith(
        'gpt-4.1-mini',
        'sk-key',
        'https://custom.api.com',
      )
    })
  })
})
