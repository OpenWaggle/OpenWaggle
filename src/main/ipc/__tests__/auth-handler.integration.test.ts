import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProviderOAuthService } from '../../ports/provider-oauth-service'

const mockHandle = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle, on: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}))

vi.mock('../../runtime', () => ({
  runAppEffectExit: (effect: Effect.Effect<unknown, unknown, ProviderOAuthService>) =>
    Effect.runPromiseExit(
      Effect.provide(
        effect,
        Layer.succeed(
          ProviderOAuthService,
          ProviderOAuthService.of({
            listProviders: () => Effect.succeed(['openrouter', 'openai']),
            login: () => Effect.void,
            logout: () => Effect.void,
            isConnected: () => Effect.succeed(false),
            getAccountInfo: (provider) =>
              Effect.succeed({
                provider,
                connected: false,
                label: 'Not connected',
              }),
          }),
        ),
      ),
    ),
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
}))

vi.mock('../../auth', () => ({
  startOAuth: vi.fn(),
  cancelOAuth: vi.fn().mockResolvedValue(undefined),
  startAuthLifecycle: vi.fn(() => vi.fn()),
  disconnect: vi.fn().mockResolvedValue(undefined),
  submitCode: vi.fn(),
  getAccountInfo: vi.fn().mockResolvedValue({
    provider: 'openrouter',
    connected: false,
    label: 'Not connected',
  }),
}))

function getRegisteredAuthHandler(
  channel: string,
): ((event: unknown, provider: string) => Promise<unknown>) | undefined {
  const call = mockHandle.mock.calls.find((candidate) => candidate[0] === channel)
  const handler = call?.[1]
  if (typeof handler !== 'function') return undefined
  return (event, provider) => handler(event, provider)
}

describe('auth-handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all auth IPC channels', async () => {
    const { registerAuthHandlers } = await import('../auth-handler')
    registerAuthHandlers()

    const registeredChannels = mockHandle.mock.calls.map((call: unknown[]) => call[0])
    expect(registeredChannels).toContain('auth:start-oauth')
    expect(registeredChannels).toContain('auth:submit-code')
    expect(registeredChannels).toContain('auth:cancel-oauth')
    expect(registeredChannels).toContain('auth:disconnect')
    expect(registeredChannels).toContain('auth:get-account-info')
  })

  it('auth:get-account-info handler returns account info', async () => {
    const { registerAuthHandlers } = await import('../auth-handler')
    registerAuthHandlers()

    const getAccountInfoHandler = getRegisteredAuthHandler('auth:get-account-info')

    if (!getAccountInfoHandler) throw new Error('auth:get-account-info handler was not registered')

    const result = await getAccountInfoHandler({}, 'openrouter')
    expect(result).toEqual({
      provider: 'openrouter',
      connected: false,
      label: 'Not connected',
    })
  })

  it('auth:get-account-info handler rejects empty provider ids', async () => {
    const { registerAuthHandlers } = await import('../auth-handler')
    registerAuthHandlers()

    const getAccountInfoHandler = getRegisteredAuthHandler('auth:get-account-info')

    if (!getAccountInfoHandler) throw new Error('auth:get-account-info handler was not registered')

    await expect(getAccountInfoHandler({}, '')).rejects.toThrow('Invalid OAuth provider')
  })

  it('auth:disconnect handler calls disconnect', async () => {
    const { disconnect } = await import('../../auth')
    const { registerAuthHandlers } = await import('../auth-handler')
    registerAuthHandlers()

    const disconnectHandler = getRegisteredAuthHandler('auth:disconnect')

    if (!disconnectHandler) throw new Error('auth:disconnect handler was not registered')

    await disconnectHandler({}, 'openai')
    expect(disconnect).toHaveBeenCalledWith('openai')
  })

  it('auth:cancel-oauth handler calls cancelOAuth', async () => {
    const { cancelOAuth } = await import('../../auth')
    const { registerAuthHandlers } = await import('../auth-handler')
    registerAuthHandlers()

    const cancelHandler = getRegisteredAuthHandler('auth:cancel-oauth')

    if (!cancelHandler) throw new Error('auth:cancel-oauth handler was not registered')

    await cancelHandler({}, 'openai')
    expect(cancelOAuth).toHaveBeenCalledWith('openai', expect.any(Function))
  })
})
