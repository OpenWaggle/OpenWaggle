import * as Effect from 'effect/Effect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  typedHandleMock,
  getSettingsMock,
  updateSettingsMock,
  providerServiceGetMock,
  probeCredentialsMock,
} = vi.hoisted(() => ({
  typedHandleMock: vi.fn(),
  getSettingsMock: vi.fn(),
  updateSettingsMock: vi.fn(),
  providerServiceGetMock: vi.fn(),
  probeCredentialsMock: vi.fn(),
}))

vi.mock('../typed-ipc', () => ({
  typedHandle: typedHandleMock,
}))

vi.mock('../../store/settings', () => ({
  getSettings: getSettingsMock,
  updateSettings: updateSettingsMock,
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
import { ProviderProbeService } from '../../ports/provider-probe-service'
import { ProviderService } from '../../ports/provider-service'
import { SettingsService } from '../../services/settings-service'
import { registerSettingsHandlers } from '../settings-handler'

const TestSettingsLayer = Layer.succeed(SettingsService, {
  get: () => Effect.sync(() => getSettingsMock()),
  update: (partial) => Effect.sync(() => updateSettingsMock(partial)),
  initialize: () => Effect.void,
  flushForTests: () => Effect.void,
})

const TestProviderServiceLayer = Layer.succeed(ProviderService, {
  get: (providerId) => Effect.sync(() => providerServiceGetMock(providerId)),
  getAll: () => Effect.succeed([]),
  getProviderForModel: () => Effect.dieMessage('not used by settings handler tests'),
  isKnownModel: () => Effect.succeed(true),
})

const TestProviderProbeLayer = Layer.succeed(ProviderProbeService, {
  probeCredentials: (input) =>
    Effect.tryPromise({
      try: () => Promise.resolve(probeCredentialsMock(input)),
      catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
    }),
})

const TestLayer = Layer.mergeAll(
  TestSettingsLayer,
  TestProviderServiceLayer,
  TestProviderProbeLayer,
)

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
    providerServiceGetMock.mockReset()
    probeCredentialsMock.mockReset()
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
        thinkingLevel: 'high',
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({ ok: true })
      expect(updateSettingsMock).toHaveBeenCalledOnce()
      expect(updateSettingsMock).toHaveBeenCalledWith(
        expect.objectContaining({
          thinkingLevel: 'high',
        }),
      )
    })

    it('rejects an invalid settings payload and returns error', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        thinkingLevel: 'invalid-mode',
      }
      const result = await handler?.({}, payload)
      expect(result).toEqual({
        ok: false,
        error: expect.any(String),
      })
      expect(updateSettingsMock).not.toHaveBeenCalled()
    })

    it('converts selectedModel canonical ref to SupportedModelId', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = { selectedModel: 'openai/gpt-4.1-mini' }
      await handler?.({}, payload)

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      // The branded type is still a string at runtime
      expect(call.selectedModel).toBe('openai/gpt-4.1-mini')
    })

    it('passes empty selectedModel through so the settings store can clear stale selections', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      await handler?.({}, { selectedModel: '' })

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.selectedModel).toBe('')
    })

    it('converts favoriteModels canonical refs to SupportedModelId array', async () => {
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:update')
      expect(handler).toBeDefined()

      const payload = {
        favoriteModels: ['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini'],
      }
      await handler?.({}, payload)

      expect(updateSettingsMock).toHaveBeenCalledOnce()
      const call = updateSettingsMock.mock.calls[0][0]
      expect(call.favoriteModels).toEqual(['anthropic/claude-sonnet-4-5', 'openai/gpt-4.1-mini'])
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
      providerServiceGetMock.mockReturnValue(undefined)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      expect(handler).toBeDefined()

      const result = await handler?.({}, 'nonexistent', 'some-key')
      expect(result).toEqual({
        success: false,
        error: 'Unknown provider: nonexistent',
      })
      expect(probeCredentialsMock).not.toHaveBeenCalled()
    })

    it('returns success when the probe succeeds', async () => {
      providerServiceGetMock.mockReturnValue({
        id: 'anthropic',
        displayName: 'Anthropic',

        auth: {
          configured: false,
          source: 'none',
          apiKeyConfigured: false,
          apiKeySource: 'none',
          oauthConnected: false,
          supportsApiKey: true,
          supportsOAuth: true,
        },
        models: [],
        testModel: 'claude-haiku-3.5',
      })
      probeCredentialsMock.mockResolvedValue(undefined)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'anthropic', 'sk-ant-test-key')

      expect(result).toEqual({ success: true })
      expect(probeCredentialsMock).toHaveBeenCalledWith({
        providerId: 'anthropic',
        modelId: 'claude-haiku-3.5',
        apiKey: 'sk-ant-test-key',
      })
    })

    it('normalizes empty API keys to undefined for keyless probes', async () => {
      providerServiceGetMock.mockReturnValue({
        id: 'ollama',
        displayName: 'Ollama',

        auth: {
          configured: false,
          source: 'none',
          apiKeyConfigured: false,
          apiKeySource: 'none',
          oauthConnected: false,
          supportsApiKey: true,
          supportsOAuth: false,
        },
        models: [],
        testModel: 'llama3.2',
      })
      probeCredentialsMock.mockResolvedValue(undefined)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'ollama', '')

      expect(result).toEqual({ success: true })
      expect(probeCredentialsMock).toHaveBeenCalledWith({
        providerId: 'ollama',
        modelId: 'llama3.2',
        apiKey: undefined,
      })
    })

    it('tests the selected provider with the supplied API key only', async () => {
      providerServiceGetMock.mockReturnValue({
        id: 'openai',
        displayName: 'OpenAI',

        auth: {
          configured: false,
          source: 'none',
          apiKeyConfigured: false,
          apiKeySource: 'none',
          oauthConnected: false,
          supportsApiKey: true,
          supportsOAuth: true,
        },
        models: [],
        testModel: 'gpt-4.1-mini',
      })
      probeCredentialsMock.mockResolvedValue(undefined)
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      await handler?.({}, 'openai', 'token')

      expect(probeCredentialsMock).toHaveBeenCalledWith({
        providerId: 'openai',
        modelId: 'gpt-4.1-mini',
        apiKey: 'token',
      })
    })

    it('returns a structured failure when the probe throws', async () => {
      providerServiceGetMock.mockReturnValue({
        id: 'gemini',
        displayName: 'Gemini',

        auth: {
          configured: false,
          source: 'none',
          apiKeyConfigured: false,
          apiKeySource: 'none',
          oauthConnected: false,
          supportsApiKey: true,
          supportsOAuth: false,
        },
        models: [],
        testModel: 'gemini-2.5-flash',
      })
      probeCredentialsMock.mockRejectedValue(new Error('Invalid API key'))
      registerSettingsHandlers()

      const handler = getTypedEffectInvokeHandler('settings:test-api-key')
      const result = await handler?.({}, 'gemini', 'bad-key')

      expect(result).toEqual({
        success: false,
        error: 'Invalid API key',
      })
    })
  })
})
