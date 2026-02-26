import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { SUBSCRIPTION_PROVIDERS } from '@shared/types/auth'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface AuthState {
  oauthStatuses: Partial<Record<SubscriptionProvider, OAuthFlowStatus>>
  authAccounts: Partial<Record<SubscriptionProvider, SubscriptionAccountInfo | null>>

  startOAuth: (provider: SubscriptionProvider) => Promise<void>
  submitAuthCode: (provider: SubscriptionProvider, code: string) => Promise<void>
  disconnectAuth: (provider: SubscriptionProvider) => Promise<void>
  loadAuthAccount: (provider: SubscriptionProvider) => Promise<void>
  loadAllAuthAccounts: () => Promise<void>
  getOAuthStatus: (provider: SubscriptionProvider) => OAuthFlowStatus
}

export const useAuthStore = create<AuthState>((set, get) => ({
  oauthStatuses: {},
  authAccounts: {},

  async startOAuth(provider: SubscriptionProvider) {
    if (provider === 'anthropic') {
      const confirmed = await api.showConfirm(
        'Claude subscription sign-in has Terms of Service risk.',
        'Anthropic may prohibit using subscription OAuth tokens in third-party applications. Continue only if you understand this risk.',
      )
      if (!confirmed) return
    }

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
      const { usePreferencesStore } = await import('./preferences-store')
      await usePreferencesStore.getState().loadSettings()
      await get().loadAuthAccount(provider)
      set((state) => ({
        oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
      }))
    } catch {
      await get().loadAuthAccount(provider)
    } finally {
      cleanup()
    }
  },

  async submitAuthCode(provider: SubscriptionProvider, code: string) {
    await api.submitAuthCode(provider, code)
  },

  async disconnectAuth(provider: SubscriptionProvider) {
    await api.disconnectAuth(provider)
    const { usePreferencesStore } = await import('./preferences-store')
    await usePreferencesStore.getState().loadSettings()
    await get().loadAuthAccount(provider)
    set((state) => ({
      oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
    }))
  },

  async loadAuthAccount(provider: SubscriptionProvider) {
    try {
      const info = await api.getAuthAccountInfo(provider)
      set((state) => ({
        authAccounts: { ...state.authAccounts, [provider]: info },
      }))
    } catch {
      // Non-critical — leave existing state
    }
  },

  async loadAllAuthAccounts() {
    await Promise.all(SUBSCRIPTION_PROVIDERS.map((provider) => get().loadAuthAccount(provider)))
  },

  getOAuthStatus(provider: SubscriptionProvider): OAuthFlowStatus {
    return get().oauthStatuses[provider] ?? { type: 'idle' }
  },
}))
