import type { OAuthFlowStatus, SubscriptionAccountInfo } from '@shared/types/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─── IPC Mock ───────────────────────────────────────────────
// The auth store imports `api` from `@/lib/ipc` and calls multiple IPC methods.
// We hoist the mock handles so they are available inside the vi.mock factory.

const { apiMock, oauthListeners } = vi.hoisted(() => {
  const listeners = new Set<(status: OAuthFlowStatus) => void>()
  return {
    oauthListeners: listeners,
    apiMock: {
      showConfirm: vi.fn().mockResolvedValue(true),
      startOAuth: vi.fn().mockResolvedValue(undefined),
      submitAuthCode: vi.fn().mockResolvedValue(undefined),
      disconnectAuth: vi.fn().mockResolvedValue(undefined),
      getAuthAccountInfo: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        connected: true,
        label: 'user@example.com',
      } satisfies SubscriptionAccountInfo),
      onOAuthStatus: vi.fn((callback: (status: OAuthFlowStatus) => void) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      }),
    },
  }
})

vi.mock('@/lib/ipc', () => ({
  api: apiMock,
}))

// ─── Preferences Store Mock ─────────────────────────────────
// auth-store dynamically imports preferences-store in startOAuth/disconnectAuth.
// We mock it to prevent the real store from being created.
// The loadSettings mock must be a stable reference so we can assert it was called.

const { prefsMock, loadSettingsMock } = vi.hoisted(() => {
  const loadSettingsFn = vi.fn().mockResolvedValue(undefined)
  return {
    loadSettingsMock: loadSettingsFn,
    prefsMock: {
      getState: vi.fn(() => ({
        loadSettings: loadSettingsFn,
      })),
    },
  }
})

vi.mock('./preferences-store', () => ({
  usePreferencesStore: prefsMock,
}))

import { useAuthStore } from './auth-store'

// ─── Tests ──────────────────────────────────────────────────

describe('auth-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    oauthListeners.clear()
    // Reset store state
    useAuthStore.setState({
      oauthStatuses: {},
      authAccounts: {},
    })
  })

  describe('initial state', () => {
    it('starts with empty oauth statuses and auth accounts', () => {
      const state = useAuthStore.getState()
      expect(state.oauthStatuses).toEqual({})
      expect(state.authAccounts).toEqual({})
    })
  })

  describe('getOAuthStatus', () => {
    it('returns idle when no status exists for the provider', () => {
      expect(useAuthStore.getState().getOAuthStatus('openrouter')).toEqual({ type: 'idle' })
    })

    it('returns the stored status when available', () => {
      const status: OAuthFlowStatus = { type: 'in-progress', provider: 'openai' }
      useAuthStore.setState({ oauthStatuses: { openai: status } })
      expect(useAuthStore.getState().getOAuthStatus('openai')).toBe(status)
    })
  })

  describe('startOAuth', () => {
    it('sets in-progress status and calls api.startOAuth', async () => {
      await useAuthStore.getState().startOAuth('openrouter')

      expect(apiMock.startOAuth).toHaveBeenCalledWith('openrouter')
      // After successful completion, status should be idle
      expect(useAuthStore.getState().getOAuthStatus('openrouter')).toEqual({ type: 'idle' })
    })

    it('registers an onOAuthStatus listener during the flow', async () => {
      // Track whether the listener was registered
      expect(apiMock.onOAuthStatus).not.toHaveBeenCalled()
      await useAuthStore.getState().startOAuth('openrouter')
      expect(apiMock.onOAuthStatus).toHaveBeenCalledTimes(1)
    })

    it('cleans up the onOAuthStatus listener after completion', async () => {
      await useAuthStore.getState().startOAuth('openrouter')
      // After startOAuth resolves, the listener should be cleaned up
      expect(oauthListeners.size).toBe(0)
    })

    it('loads auth account info after successful OAuth', async () => {
      await useAuthStore.getState().startOAuth('openrouter')

      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openrouter')
      expect(useAuthStore.getState().authAccounts.openrouter).toEqual({
        provider: 'openrouter',
        connected: true,
        label: 'user@example.com',
      })
    })

    it('reloads settings via preferences store after success', async () => {
      await useAuthStore.getState().startOAuth('openrouter')

      expect(prefsMock.getState).toHaveBeenCalled()
      expect(loadSettingsMock).toHaveBeenCalled()
    })

    it('shows confirmation dialog for anthropic provider', async () => {
      await useAuthStore.getState().startOAuth('anthropic')
      expect(apiMock.showConfirm).toHaveBeenCalledWith(
        expect.stringContaining('Claude subscription'),
        expect.any(String),
      )
    })

    it('aborts anthropic OAuth when user declines confirmation', async () => {
      apiMock.showConfirm.mockResolvedValueOnce(false)
      await useAuthStore.getState().startOAuth('anthropic')

      expect(apiMock.startOAuth).not.toHaveBeenCalled()
    })

    it('does not show confirmation dialog for non-anthropic providers', async () => {
      await useAuthStore.getState().startOAuth('openrouter')
      expect(apiMock.showConfirm).not.toHaveBeenCalled()
    })

    it('still loads account info when startOAuth rejects', async () => {
      apiMock.startOAuth.mockRejectedValueOnce(new Error('OAuth flow failed'))
      await useAuthStore.getState().startOAuth('openrouter')

      // The catch block should still call loadAuthAccount
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openrouter')
    })

    it('cleans up listener even when startOAuth rejects', async () => {
      apiMock.startOAuth.mockRejectedValueOnce(new Error('OAuth flow failed'))
      await useAuthStore.getState().startOAuth('openrouter')
      expect(oauthListeners.size).toBe(0)
    })

    it('updates status from onOAuthStatus listener for events without provider field', async () => {
      // Delay startOAuth so we can emit events during the flow
      let resolveOAuth: () => void = () => {}
      apiMock.startOAuth.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveOAuth = resolve
          }),
      )

      const promise = useAuthStore.getState().startOAuth('openai')

      // Emit a status event WITHOUT a provider field (handled by the local listener)
      const statusEvent = { type: 'awaiting-code' } as OAuthFlowStatus
      for (const listener of oauthListeners) {
        listener(statusEvent)
      }

      expect(useAuthStore.getState().oauthStatuses.openai).toBe(statusEvent)

      // Resolve to complete the flow
      resolveOAuth()
      await promise
    })

    it('ignores onOAuthStatus events that have a provider field', async () => {
      let resolveOAuth: () => void = () => {}
      apiMock.startOAuth.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveOAuth = resolve
          }),
      )

      const promise = useAuthStore.getState().startOAuth('openai')

      // Emit a status WITH a provider field (should be ignored by the local listener)
      const statusEvent: OAuthFlowStatus = { type: 'success', provider: 'openai' }
      for (const listener of oauthListeners) {
        listener(statusEvent)
      }

      // The local listener should NOT have updated the status because it has a provider field
      // (it should be in-progress from the initial set)
      expect(useAuthStore.getState().oauthStatuses.openai).toEqual({
        type: 'in-progress',
        provider: 'openai',
      })

      resolveOAuth()
      await promise
    })
  })

  describe('submitAuthCode', () => {
    it('forwards the code to the IPC api', async () => {
      await useAuthStore.getState().submitAuthCode('openrouter', 'auth-code-123')
      expect(apiMock.submitAuthCode).toHaveBeenCalledWith('openrouter', 'auth-code-123')
    })
  })

  describe('disconnectAuth', () => {
    it('calls api.disconnectAuth and reloads settings', async () => {
      await useAuthStore.getState().disconnectAuth('openrouter')

      expect(apiMock.disconnectAuth).toHaveBeenCalledWith('openrouter')
      expect(prefsMock.getState).toHaveBeenCalled()
      expect(loadSettingsMock).toHaveBeenCalled()
    })

    it('loads account info after disconnecting', async () => {
      await useAuthStore.getState().disconnectAuth('openrouter')
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openrouter')
    })

    it('sets oauth status to idle after disconnecting', async () => {
      // Set a non-idle status first
      useAuthStore.setState({
        oauthStatuses: { openrouter: { type: 'success', provider: 'openrouter' } },
      })

      await useAuthStore.getState().disconnectAuth('openrouter')
      expect(useAuthStore.getState().getOAuthStatus('openrouter')).toEqual({ type: 'idle' })
    })
  })

  describe('loadAuthAccount', () => {
    it('stores account info from the IPC response', async () => {
      const accountInfo: SubscriptionAccountInfo = {
        provider: 'openai',
        connected: true,
        label: 'test@openai.com',
      }
      apiMock.getAuthAccountInfo.mockResolvedValueOnce(accountInfo)

      await useAuthStore.getState().loadAuthAccount('openai')
      expect(useAuthStore.getState().authAccounts.openai).toBe(accountInfo)
    })

    it('does not throw when getAuthAccountInfo rejects', async () => {
      apiMock.getAuthAccountInfo.mockRejectedValueOnce(new Error('Network error'))

      // Should not throw — the catch block silently swallows
      await expect(useAuthStore.getState().loadAuthAccount('openai')).resolves.toBeUndefined()
    })

    it('preserves existing account info for other providers', async () => {
      const existingInfo: SubscriptionAccountInfo = {
        provider: 'openrouter',
        connected: true,
        label: 'existing@or.com',
      }
      useAuthStore.setState({ authAccounts: { openrouter: existingInfo } })

      const newInfo: SubscriptionAccountInfo = {
        provider: 'openai',
        connected: false,
        label: 'new@openai.com',
      }
      apiMock.getAuthAccountInfo.mockResolvedValueOnce(newInfo)

      await useAuthStore.getState().loadAuthAccount('openai')
      expect(useAuthStore.getState().authAccounts.openrouter).toBe(existingInfo)
      expect(useAuthStore.getState().authAccounts.openai).toBe(newInfo)
    })
  })

  describe('loadAllAuthAccounts', () => {
    it('loads account info for all subscription providers', async () => {
      await useAuthStore.getState().loadAllAuthAccounts()

      // SUBSCRIPTION_PROVIDERS = ['openrouter', 'openai', 'anthropic']
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledTimes(3)
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openrouter')
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openai')
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('anthropic')
    })

    it('stores all fetched account info', async () => {
      const makeInfo = (provider: string): SubscriptionAccountInfo => ({
        provider: provider as never,
        connected: true,
        label: `${provider}@test.com`,
      })

      apiMock.getAuthAccountInfo
        .mockResolvedValueOnce(makeInfo('openrouter'))
        .mockResolvedValueOnce(makeInfo('openai'))
        .mockResolvedValueOnce(makeInfo('anthropic'))

      await useAuthStore.getState().loadAllAuthAccounts()

      const accounts = useAuthStore.getState().authAccounts
      expect(accounts.openrouter?.label).toBe('openrouter@test.com')
      expect(accounts.openai?.label).toBe('openai@test.com')
      expect(accounts.anthropic?.label).toBe('anthropic@test.com')
    })

    it('succeeds even when some providers fail', async () => {
      apiMock.getAuthAccountInfo
        .mockResolvedValueOnce({ provider: 'openrouter', connected: true, label: 'ok' })
        .mockRejectedValueOnce(new Error('openai failed'))
        .mockResolvedValueOnce({ provider: 'anthropic', connected: false, label: 'disconnected' })

      // Should not throw
      await expect(useAuthStore.getState().loadAllAuthAccounts()).resolves.toBeUndefined()

      // The successful ones should still be stored
      expect(useAuthStore.getState().authAccounts.openrouter?.label).toBe('ok')
    })
  })
})
