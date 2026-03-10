import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
  startAnthropicOAuth: vi.fn(),
  refreshAnthropicToken: vi.fn(),
  startOpenAIOAuth: vi.fn(),
  refreshOpenAIToken: vi.fn(),
  startOpenRouterOAuth: vi.fn(),
  clearPreviousApiKey: vi.fn(),
  clearTokens: vi.fn(),
  getActiveAccessToken: vi.fn(),
  hasStoredUsableAccessToken: vi.fn(),
  getPreviousApiKey: vi.fn(),
  registerRefreshFn: vi.fn(),
  storePreviousApiKey: vi.fn(),
  storeTokens: vi.fn(),
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../../store/settings', () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}))

vi.mock('../flows/anthropic-oauth', () => ({
  startAnthropicOAuth: mocks.startAnthropicOAuth,
  refreshAnthropicToken: mocks.refreshAnthropicToken,
}))

vi.mock('../flows/openai-oauth', () => ({
  startOpenAIOAuth: mocks.startOpenAIOAuth,
  refreshOpenAIToken: mocks.refreshOpenAIToken,
}))

vi.mock('../flows/openrouter-oauth', () => ({
  startOpenRouterOAuth: mocks.startOpenRouterOAuth,
}))

vi.mock('../token-manager', () => ({
  clearPreviousApiKey: mocks.clearPreviousApiKey,
  clearTokens: mocks.clearTokens,
  getActiveAccessToken: mocks.getActiveAccessToken,
  hasStoredUsableAccessToken: mocks.hasStoredUsableAccessToken,
  getPreviousApiKey: mocks.getPreviousApiKey,
  registerRefreshFn: mocks.registerRefreshFn,
  storePreviousApiKey: mocks.storePreviousApiKey,
  storeTokens: mocks.storeTokens,
}))

function makeSettings() {
  return {
    providers: {
      openai: { apiKey: 'manual-openai-key', enabled: true, authMethod: 'api-key' as const },
      anthropic: { apiKey: '', enabled: true, authMethod: 'api-key' as const },
      openrouter: { apiKey: '', enabled: true, authMethod: 'api-key' as const },
    },
  }
}

describe('auth index', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.getSettings.mockReturnValue(makeSettings())
    mocks.getPreviousApiKey.mockReturnValue('')
    mocks.startOpenRouterOAuth.mockResolvedValue({ apiKey: 'sk-or-v1-auth' })
    mocks.startOpenAIOAuth.mockResolvedValue({
      accessToken: 'openai-at',
      refreshToken: 'openai-rt',
      expiresAt: Date.now() + 60_000,
    })
    mocks.startAnthropicOAuth.mockResolvedValue({
      accessToken: 'anthropic-at',
      refreshToken: 'anthropic-rt',
      expiresAt: Date.now() + 60_000,
    })
    mocks.refreshOpenAIToken.mockResolvedValue({
      accessToken: 'new-openai-at',
      expiresAt: Date.now(),
    })
    mocks.refreshAnthropicToken.mockResolvedValue({
      accessToken: 'new-anthropic-at',
      refreshToken: 'new-anthropic-rt',
      expiresAt: Date.now(),
    })
    mocks.getActiveAccessToken.mockResolvedValue('active-token')
    mocks.hasStoredUsableAccessToken.mockReturnValue(true)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects concurrent sign-in attempts per provider', async () => {
    let resolveFlow!: (value: {
      accessToken: string
      refreshToken: string
      expiresAt: number
    }) => void
    const pendingFlow = new Promise<{
      accessToken: string
      refreshToken: string
      expiresAt: number
    }>((resolve) => {
      resolveFlow = resolve
    })

    mocks.startOpenAIOAuth.mockImplementation(
      ({ manualCodePromise }: { manualCodePromise?: Promise<string> }) => {
        void manualCodePromise?.catch(() => {})
        return pendingFlow
      },
    )

    const { startOAuth } = await import('../index')
    const emitStatus = vi.fn()

    const firstFlow = startOAuth('openai', emitStatus)
    await Promise.resolve()

    await expect(startOAuth('openai', emitStatus)).rejects.toThrow(
      'A sign-in attempt is already in progress for this provider.',
    )

    resolveFlow({
      accessToken: 'openai-at',
      refreshToken: 'openai-rt',
      expiresAt: Date.now() + 60_000,
    })
    await firstFlow
  })

  it('supports manual auth code handoff for OpenAI and emits status transitions', async () => {
    mocks.startOpenAIOAuth.mockImplementation(
      async ({
        manualCodePromise,
        onAwaitingCode,
        onCodeReceived,
      }: {
        manualCodePromise?: Promise<string>
        onAwaitingCode?: () => void
        onCodeReceived?: () => void
      }) => {
        onAwaitingCode?.()
        const code = await manualCodePromise
        expect(code).toBe('code#state')
        onCodeReceived?.()
        return {
          accessToken: 'openai-at',
          refreshToken: 'openai-rt',
          expiresAt: Date.now() + 60_000,
        }
      },
    )

    const { startOAuth, submitCode } = await import('../index')
    const emitStatus = vi.fn()

    const runPromise = startOAuth('openai', emitStatus)
    submitCode('openai', 'code#state')
    await runPromise

    expect(emitStatus.mock.calls.map((c) => c[0].type)).toEqual([
      'in-progress',
      'awaiting-code',
      'code-received',
      'success',
    ])
    expect(mocks.updateSettings).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          openai: expect.objectContaining({ authMethod: 'subscription' }),
        }),
      }),
    )
  })

  it('emits one lifecycle expiry error and a recovery success when token refresh recovers', async () => {
    vi.useFakeTimers()

    mocks.getSettings.mockReturnValue({
      providers: {
        openai: { apiKey: 'openai-at', enabled: true, authMethod: 'subscription' as const },
        anthropic: { apiKey: '', enabled: false, authMethod: 'api-key' as const },
        openrouter: { apiKey: '', enabled: false, authMethod: 'api-key' as const },
      },
    })
    mocks.hasStoredUsableAccessToken.mockReturnValueOnce(false).mockReturnValueOnce(true)

    const { startAuthLifecycle } = await import('../index')
    const emitStatus = vi.fn()

    const stop = startAuthLifecycle(emitStatus)
    await Promise.resolve()

    expect(emitStatus).toHaveBeenCalledWith({
      type: 'error',
      provider: 'openai',
      message: 'Session expired. Please sign in again.',
    })

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000)
    await Promise.resolve()

    expect(emitStatus).toHaveBeenCalledWith({ type: 'success', provider: 'openai' })
    stop()
  })
})
