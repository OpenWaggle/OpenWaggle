import type { OAuthAccountInfo, OAuthFlowStatus, OAuthProvider } from '@shared/types/auth'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('auth')

interface AuthState {
  oauthStatuses: Partial<Record<OAuthProvider, OAuthFlowStatus>>
  authAccounts: Partial<Record<OAuthProvider, OAuthAccountInfo | null>>

  startOAuth: (provider: OAuthProvider) => Promise<void>
  submitAuthCode: (provider: OAuthProvider, code: string) => Promise<void>
  cancelOAuth: (provider: OAuthProvider) => Promise<void>
  disconnectAuth: (provider: OAuthProvider) => Promise<void>
  loadAuthAccount: (provider: OAuthProvider) => Promise<void>
  loadAllAuthAccounts: (providers?: readonly OAuthProvider[]) => Promise<void>
  getOAuthStatus: (provider: OAuthProvider) => OAuthFlowStatus
}

export const useAuthStore = create<AuthState>((set, get) => ({
  oauthStatuses: {},
  authAccounts: {},

  async startOAuth(provider: OAuthProvider) {
    set((state) => ({
      oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'in-progress', provider } },
    }))

    const cleanup = api.onOAuthStatus((status) => {
      // Only handle statuses without a provider field (fallback to the active flow's provider).
      // Statuses WITH a provider field are handled by the global listener in useSettingsSetup.
      if (!('provider' in status)) {
        set((state) => ({
          oauthStatuses: { ...state.oauthStatuses, [provider]: status },
        }))
      }
    })

    try {
      await api.startOAuth(provider)
      const { useProviderStore } = await import('./provider-store')
      await useProviderStore.getState().loadProviderModels()
      await get().loadAuthAccount(provider)
      set((state) => ({
        oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('Failed to start OAuth flow', { provider, message })
      set((state) => ({
        oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'error', provider, message } },
      }))
      await get().loadAuthAccount(provider)
    } finally {
      cleanup()
    }
  },

  async submitAuthCode(provider: OAuthProvider, code: string) {
    await api.submitAuthCode(provider, code)
  },

  async cancelOAuth(provider: OAuthProvider) {
    await api.cancelOAuth(provider)
    const { useProviderStore } = await import('./provider-store')
    await useProviderStore.getState().loadProviderModels()
    await get().loadAuthAccount(provider)
    set((state) => ({
      oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
    }))
  },

  async disconnectAuth(provider: OAuthProvider) {
    await api.disconnectAuth(provider)
    const { useProviderStore } = await import('./provider-store')
    await useProviderStore.getState().loadProviderModels()
    await get().loadAuthAccount(provider)
    set((state) => ({
      oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
    }))
  },

  async loadAuthAccount(provider: OAuthProvider) {
    try {
      const info = await api.getAuthAccountInfo(provider)
      set((state) => ({
        authAccounts: { ...state.authAccounts, [provider]: info },
      }))
    } catch (err) {
      logger.warn('Failed to load auth account info', { error: String(err) })
    }
  },

  async loadAllAuthAccounts(providers?: readonly OAuthProvider[]) {
    const providerIds = providers ?? []
    await Promise.all(providerIds.map((provider) => get().loadAuthAccount(provider)))
  },

  getOAuthStatus(provider: OAuthProvider): OAuthFlowStatus {
    return get().oauthStatuses[provider] ?? { type: 'idle' }
  },
}))
