import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { SUBSCRIPTION_PROVIDERS } from '@shared/types/auth'
import type { ProviderInfo, SupportedModelId } from '@shared/types/llm'
import {
  DEFAULT_SETTINGS,
  type ExecutionMode,
  type Provider,
  type ProviderConfig,
  type QualityPreset,
  type Settings,
} from '@shared/types/settings'
import { isValidBaseUrl } from '@shared/utils/validation'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  loadError: string | null
  testingProviders: Partial<Record<Provider, boolean>>
  testResults: Partial<Record<Provider, { success: boolean; error?: string } | null>>
  providerModels: ProviderInfo[]

  // Auth — per-provider status tracking
  oauthStatuses: Partial<Record<SubscriptionProvider, OAuthFlowStatus>>
  authAccounts: Partial<Record<SubscriptionProvider, SubscriptionAccountInfo | null>>

  loadSettings: () => Promise<void>
  loadProviderModels: () => Promise<void>
  retryLoad: () => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  toggleProvider: (provider: Provider, enabled: boolean) => Promise<void>
  updateBaseUrl: (provider: Provider, baseUrl: string) => Promise<void>
  setDefaultModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  setExecutionMode: (mode: ExecutionMode) => Promise<void>
  setQualityPreset: (preset: QualityPreset) => Promise<void>
  setBrowserHeadless: (headless: boolean) => Promise<void>
  pushRecentProject: (path: string) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string, baseUrl?: string) => Promise<boolean>
  clearTestResult: (provider: Provider) => void

  // Auth actions
  startOAuth: (provider: SubscriptionProvider) => Promise<void>
  submitAuthCode: (provider: SubscriptionProvider, code: string) => Promise<void>
  disconnectAuth: (provider: SubscriptionProvider) => Promise<void>
  loadAuthAccount: (provider: SubscriptionProvider) => Promise<void>
  loadAllAuthAccounts: () => Promise<void>
  getOAuthStatus: (provider: SubscriptionProvider) => OAuthFlowStatus
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  loadError: null,
  testingProviders: {},
  testResults: {},
  providerModels: [],
  oauthStatuses: {},
  authAccounts: {},

  async loadSettings() {
    try {
      const settings = await api.getSettings()
      set({ settings, isLoaded: true, loadError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      set({ isLoaded: true, loadError: message })
    }
  },

  async loadProviderModels() {
    try {
      const providerModels = await api.getProviderModels()
      set({ providerModels })
    } catch {
      // Models are non-critical — keep existing empty array
    }
  },

  async retryLoad() {
    set({ loadError: null, isLoaded: false })
    await get().loadSettings()
    await get().loadProviderModels()
  },

  async updateApiKey(provider: Provider, apiKey: string) {
    const normalizedApiKey = apiKey.trim()

    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          ...existing,
          apiKey: normalizedApiKey,
          enabled: normalizedApiKey ? (existing?.enabled ?? true) : false,
        } satisfies ProviderConfig,
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
  },

  async toggleProvider(provider: Provider, enabled: boolean) {
    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          apiKey: existing?.apiKey ?? '',
          baseUrl: existing?.baseUrl,
          enabled,
        },
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
  },

  async updateBaseUrl(provider: Provider, baseUrl: string) {
    const normalizedBaseUrl = baseUrl.trim()
    if (normalizedBaseUrl && !isValidBaseUrl(normalizedBaseUrl)) return

    const { settings } = get()
    const existing = settings.providers[provider]
    const updated: Settings = {
      ...settings,
      providers: {
        ...settings.providers,
        [provider]: {
          apiKey: existing?.apiKey ?? '',
          enabled: existing?.enabled ?? false,
          baseUrl: normalizedBaseUrl || undefined,
        },
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
  },

  async setDefaultModel(model: SupportedModelId) {
    const { settings } = get()
    await api.updateSettings({ defaultModel: model })
    set({ settings: { ...settings, defaultModel: model } })
  },

  async setProjectPath(path: string | null) {
    const { settings } = get()
    let recentProjects = settings.recentProjects
    if (path) {
      const deduped = [path, ...settings.recentProjects.filter((p) => p !== path)]
      recentProjects = deduped.slice(0, 10)
    }
    await api.updateSettings({ projectPath: path, recentProjects })
    set({ settings: { ...settings, projectPath: path, recentProjects } })
  },

  async setExecutionMode(mode: ExecutionMode) {
    const { settings } = get()
    await api.updateSettings({ executionMode: mode })
    set({ settings: { ...settings, executionMode: mode } })
  },

  async setQualityPreset(preset: QualityPreset) {
    const { settings } = get()
    await api.updateSettings({ qualityPreset: preset })
    set({ settings: { ...settings, qualityPreset: preset } })
  },

  async setBrowserHeadless(headless: boolean) {
    const { settings } = get()
    await api.updateSettings({ browserHeadless: headless })
    set({ settings: { ...settings, browserHeadless: headless } })
  },

  async pushRecentProject(path: string) {
    const normalized = path.trim()
    if (!normalized) return

    const { settings } = get()
    const recentProjects = [
      normalized,
      ...settings.recentProjects.filter((p) => p !== normalized),
    ].slice(0, 10)
    await api.updateSettings({ recentProjects })
    set({ settings: { ...settings, recentProjects } })
  },

  async testApiKey(provider: Provider, apiKey: string, baseUrl?: string) {
    set((state) => ({
      testingProviders: { ...state.testingProviders, [provider]: true },
    }))
    try {
      const result = await api.testApiKey(provider, apiKey, baseUrl)
      set((state) => ({
        testResults: { ...state.testResults, [provider]: result },
        testingProviders: { ...state.testingProviders, [provider]: false },
      }))
      return result.success
    } catch {
      set((state) => ({
        testResults: {
          ...state.testResults,
          [provider]: { success: false, error: 'Unexpected error — check the console' },
        },
        testingProviders: { ...state.testingProviders, [provider]: false },
      }))
      return false
    }
  },

  clearTestResult(provider: Provider) {
    set((state) => ({
      testResults: { ...state.testResults, [provider]: null },
    }))
  },

  async startOAuth(provider: SubscriptionProvider) {
    set((state) => ({
      oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'in-progress', provider } },
    }))

    // Listen for status events from the main process (e.g. 'awaiting-code')
    const cleanup = api.onOAuthStatus((status) => {
      const statusProvider = 'provider' in status ? status.provider : provider
      set((state) => ({
        oauthStatuses: { ...state.oauthStatuses, [statusProvider]: status },
      }))
    })

    try {
      await api.startOAuth(provider)
      // Reload settings + auth account to reflect new connected state
      await get().loadSettings()
      await get().loadAuthAccount(provider)
      // Reset status to idle now that auth account is loaded
      set((state) => ({
        oauthStatuses: { ...state.oauthStatuses, [provider]: { type: 'idle' } },
      }))
    } catch {
      // Error status arrives via IPC event before this catch runs.
      // Reload auth account so the UI can show disconnected state if needed.
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
    await get().loadSettings()
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
