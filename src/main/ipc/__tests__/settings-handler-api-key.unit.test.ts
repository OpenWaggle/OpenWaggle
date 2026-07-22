import { beforeEach, describe, expect, it } from 'vitest'
import {
  getTypedEffectInvokeHandler,
  loadSettingsHandlers,
  probeCredentialsMock,
  providerServiceGetMock,
  resetSettingsHandlerMocks,
} from './settings-handler.test-harness'

describe('registerSettingsHandlers settings:test-api-key', () => {
  let registerSettingsHandlers: Awaited<
    ReturnType<typeof loadSettingsHandlers>
  >['registerSettingsHandlers']

  beforeEach(async () => {
    resetSettingsHandlerMocks()
    ;({ registerSettingsHandlers } = await loadSettingsHandlers())
  })

  it('returns error for unknown provider', async () => {
    providerServiceGetMock.mockReturnValue(undefined)
    registerSettingsHandlers()

    const handler = getTypedEffectInvokeHandler('settings:test-api-key')
    expect(handler).toBeDefined()

    const result = await handler?.({}, 'nonexistent', 'some-key')
    expect(result).toEqual({ success: false, error: 'Unknown provider: nonexistent' })
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

    expect(result).toEqual({ success: false, error: 'Invalid API key' })
  })
})
