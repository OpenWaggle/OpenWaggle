import type { OAuthFlowStatus } from '@shared/types/auth'
import type { Effect as EffectType } from 'effect/Effect'
import * as Effect from 'effect/Effect'
import type { MessageBoxOptions, MessageBoxReturnValue } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ProviderOAuthService as ProviderOAuthServiceContext,
  ProviderOAuthServiceShape,
} from '../../ports/provider-oauth-service'

const { loginMock, showMessageBoxMock, openExternalMock, warnMock, infoMock } = vi.hoisted(() => ({
  loginMock: vi.fn<ProviderOAuthServiceShape['login']>(),
  showMessageBoxMock: vi.fn<(options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(),
  openExternalMock: vi.fn<(url: string) => Promise<void>>(),
  warnMock: vi.fn(),
  infoMock: vi.fn(),
}))

vi.mock('electron', () => ({
  dialog: { showMessageBox: showMessageBoxMock },
  shell: { openExternal: openExternalMock },
}))

vi.mock('../../logger', () => ({
  createLogger: () => ({ info: infoMock, warn: warnMock }),
}))

vi.mock('../../runtime', async () => {
  const EffectModule = await import('effect/Effect')
  const LayerModule = await import('effect/Layer')
  const { ProviderOAuthService } = await import('../../ports/provider-oauth-service')

  const oauthService = ProviderOAuthService.of({
    listProviders: () => EffectModule.succeed(['openrouter']),
    login: loginMock,
    logout: () => EffectModule.void,
    isConnected: () => EffectModule.succeed(false),
    getAccountInfo: (provider) =>
      EffectModule.succeed({
        provider,
        connected: false,
        label: 'Not connected',
      }),
  } satisfies ProviderOAuthServiceShape)

  return {
    runAppEffect: (effect: EffectType<unknown, unknown, ProviderOAuthServiceContext>) =>
      EffectModule.runPromise(
        EffectModule.provide(effect, LayerModule.succeed(ProviderOAuthService, oauthService)),
      ),
  }
})

describe('OAuth flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    showMessageBoxMock.mockResolvedValue({ response: 1, checkboxChecked: false })
    openExternalMock.mockResolvedValue(undefined)
  })

  it('returns the OAuth option selected by the user instead of defaulting to the first option', async () => {
    let selectedOption: string | undefined
    loginMock.mockImplementation((_provider, handlers) =>
      Effect.tryPromise({
        try: async () => {
          selectedOption = await handlers.onSelect({
            message: 'Choose how to sign in',
            options: [
              { id: 'browser', label: 'Browser' },
              { id: 'device-code', label: 'Device code' },
            ],
          })
        },
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }),
    )

    const { startOAuth } = await import('../index')
    const statuses: OAuthFlowStatus[] = []

    await startOAuth('openrouter', (status) => {
      statuses.push(status)
    })

    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        buttons: ['Browser', 'Device code', 'Cancel'],
        cancelId: 2,
        defaultId: 0,
        message: 'Choose how to sign in',
      }),
    )
    expect(selectedOption).toBe('device-code')
    expect(statuses).toContainEqual({ type: 'success', provider: 'openrouter' })
  })
})
