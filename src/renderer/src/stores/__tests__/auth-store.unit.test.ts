import type { OAuthAccountInfo, OAuthFlowStatus } from '@shared/types/auth'
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
      cancelOAuth: vi.fn().mockResolvedValue(undefined),
      disconnectAuth: vi.fn().mockResolvedValue(undefined),
      getAuthAccountInfo: vi.fn().mockResolvedValue({
        provider: 'openrouter',
        connected: true,
        label: 'user@example.com',
      } satisfies OAuthAccountInfo),
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

const { providerStoreMock, loadProviderModelsMock } = vi.hoisted(() => {
  const loadProviderModelsFn = vi.fn().mockResolvedValue(undefined)
  return {
    loadProviderModelsMock: loadProviderModelsFn,
    providerStoreMock: {
      getState: vi.fn(() => ({
        loadProviderModels: loadProviderModelsFn,
      })),
    },
  }
})

vi.mock('../provider-store', () => ({
  useProviderStore: providerStoreMock,
}))

import { useAuthStore } from '../auth-store'

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

    it('reloads Pi provider models after success', async () => {
      await useAuthStore.getState().startOAuth('openrouter')

      expect(providerStoreMock.getState).toHaveBeenCalled()
      expect(loadProviderModelsMock).toHaveBeenCalled()
    })

    it('starts anthropic OAuth directly through the Pi-backed auth flow', async () => {
      await useAuthStore.getState().startOAuth('anthropic')

      expect(apiMock.showConfirm).not.toHaveBeenCalled()
      expect(apiMock.startOAuth).toHaveBeenCalledWith('anthropic')
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
      const statusEvent: OAuthFlowStatus = { type: 'awaiting-code' }
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
    it('calls api.disconnectAuth and reloads Pi provider models', async () => {
      await useAuthStore.getState().disconnectAuth('openrouter')

      expect(apiMock.disconnectAuth).toHaveBeenCalledWith('openrouter')
      expect(providerStoreMock.getState).toHaveBeenCalled()
      expect(loadProviderModelsMock).toHaveBeenCalled()
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

  describe('cancelOAuth', () => {
    it('calls api.cancelOAuth and reloads Pi provider models', async () => {
      await useAuthStore.getState().cancelOAuth('openrouter')

      expect(apiMock.cancelOAuth).toHaveBeenCalledWith('openrouter')
      expect(providerStoreMock.getState).toHaveBeenCalled()
      expect(loadProviderModelsMock).toHaveBeenCalled()
    })

    it('loads account info and sets oauth status to idle after canceling', async () => {
      useAuthStore.setState({
        oauthStatuses: { openrouter: { type: 'awaiting-code', provider: 'openrouter' } },
      })

      await useAuthStore.getState().cancelOAuth('openrouter')

      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openrouter')
      expect(useAuthStore.getState().getOAuthStatus('openrouter')).toEqual({ type: 'idle' })
    })
  })

  describe('loadAuthAccount', () => {
    it('stores account info from the IPC response', async () => {
      const accountInfo: OAuthAccountInfo = {
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
      const existingInfo: OAuthAccountInfo = {
        provider: 'openrouter',
        connected: true,
        label: 'existing@or.com',
      }
      useAuthStore.setState({ authAccounts: { openrouter: existingInfo } })

      const newInfo: OAuthAccountInfo = {
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
    it('loads account info for all OAuth providers', async () => {
      await useAuthStore
        .getState()
        .loadAllAuthAccounts(['openai-codex', 'github-copilot', 'google-gemini-cli'])

      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledTimes(3)
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('openai-codex')
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('github-copilot')
      expect(apiMock.getAuthAccountInfo).toHaveBeenCalledWith('google-gemini-cli')
    })

    it('stores all fetched account info', async () => {
      const makeInfo = (provider: string): OAuthAccountInfo => ({
        provider,
        connected: true,
        label: `${provider}@test.com`,
      })

      apiMock.getAuthAccountInfo
        .mockResolvedValueOnce(makeInfo('openai-codex'))
        .mockResolvedValueOnce(makeInfo('github-copilot'))
        .mockResolvedValueOnce(makeInfo('google-gemini-cli'))

      await useAuthStore
        .getState()
        .loadAllAuthAccounts(['openai-codex', 'github-copilot', 'google-gemini-cli'])

      const accounts = useAuthStore.getState().authAccounts
      expect(accounts['openai-codex']?.label).toBe('openai-codex@test.com')
      expect(accounts['github-copilot']?.label).toBe('github-copilot@test.com')
      expect(accounts['google-gemini-cli']?.label).toBe('google-gemini-cli@test.com')
    })

    it('succeeds even when some providers fail', async () => {
      apiMock.getAuthAccountInfo
        .mockResolvedValueOnce({ provider: 'openai-codex', connected: true, label: 'ok' })
        .mockRejectedValueOnce(new Error('github-copilot failed'))
        .mockResolvedValueOnce({
          provider: 'google-gemini-cli',
          connected: false,
          label: 'disconnected',
        })

      // Should not throw
      await expect(
        useAuthStore
          .getState()
          .loadAllAuthAccounts(['openai-codex', 'github-copilot', 'google-gemini-cli']),
      ).resolves.toBeUndefined()

      // The successful ones should still be stored
      expect(useAuthStore.getState().authAccounts['openai-codex']?.label).toBe('ok')
    })
  })
})
