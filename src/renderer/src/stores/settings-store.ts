import type {
  OAuthFlowStatus,
  SubscriptionAccountInfo,
  SubscriptionProvider,
} from '@shared/types/auth'
import { SUBSCRIPTION_PROVIDERS } from '@shared/types/auth'
import type { ModelDisplayInfo, ProviderInfo, SupportedModelId } from '@shared/types/llm'
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

interface ProviderModelRefreshResult {
  readonly provider: Provider
  readonly models: ModelDisplayInfo[] | null
}

let providerModelRefreshRequestToken = 0

function dedupeProviderModels(
  provider: Provider,
  models: readonly ModelDisplayInfo[],
): ModelDisplayInfo[] {
  const seen = new Set<string>()
  const deduped: ModelDisplayInfo[] = []

  for (const model of models) {
    const normalizedId = model.id.trim()
    if (!normalizedId) continue

    const key = `${provider}:${normalizedId}`
    if (seen.has(key)) continue
    seen.add(key)

    deduped.push({
      id: normalizedId,
      name: model.name,
      provider,
    })
  }

  return deduped
}

function normalizeProviderGroups(providerModels: readonly ProviderInfo[]): ProviderInfo[] {
  return providerModels.map((group) => ({
    ...group,
    models: dedupeProviderModels(group.provider, group.models),
  }))
}

function mergeProviderGroups({
  baseProviderModels,
  currentProviderModels,
  refreshedProviders,
  refreshedDynamicModels,
}: {
  baseProviderModels: readonly ProviderInfo[]
  currentProviderModels: readonly ProviderInfo[]
  refreshedProviders: readonly Provider[]
  refreshedDynamicModels: ReadonlyMap<Provider, readonly ModelDisplayInfo[]>
}): ProviderInfo[] {
  const currentByProvider = new Map(currentProviderModels.map((group) => [group.provider, group]))
  const refreshedProviderSet = new Set(refreshedProviders)

  return baseProviderModels.map((baseGroup) => {
    const dynamicModels = refreshedDynamicModels.get(baseGroup.provider)
    const currentModels = currentByProvider.get(baseGroup.provider)?.models

    const sourceModels = refreshedProviderSet.has(baseGroup.provider)
      ? (dynamicModels ?? baseGroup.models)
      : (currentModels ?? baseGroup.models)

    return {
      ...baseGroup,
      models: dedupeProviderModels(baseGroup.provider, sourceModels),
    }
  })
}

interface SettingsState {
  settings: Settings
  isLoaded: boolean
  loadError: string | null
  testingProviders: Partial<Record<Provider, boolean>>
  testResults: Partial<Record<Provider, { success: boolean; error?: string } | null>>
  baseProviderModels: ProviderInfo[]
  providerModels: ProviderInfo[]

  // Auth — per-provider status tracking
  oauthStatuses: Partial<Record<SubscriptionProvider, OAuthFlowStatus>>
  authAccounts: Partial<Record<SubscriptionProvider, SubscriptionAccountInfo | null>>

  loadSettings: () => Promise<void>
  loadProviderModels: () => Promise<void>
  refreshProviderModels: (provider?: Provider) => Promise<void>
  retryLoad: () => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  toggleProvider: (provider: Provider, enabled: boolean) => Promise<void>
  updateBaseUrl: (provider: Provider, baseUrl: string) => Promise<void>
  setDefaultModel: (model: SupportedModelId) => Promise<void>
  toggleFavoriteModel: (model: SupportedModelId) => Promise<void>
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
  baseProviderModels: [],
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
      const baseProviderModels = normalizeProviderGroups(await api.getProviderModels())
      set({ baseProviderModels, providerModels: baseProviderModels })
      await get().refreshProviderModels()
    } catch {
      // Models are non-critical — keep existing empty array
    }
  },

  async refreshProviderModels(provider?: Provider) {
    const requestToken = providerModelRefreshRequestToken + 1
    providerModelRefreshRequestToken = requestToken

    const { baseProviderModels, settings } = get()
    const targetProviders = provider
      ? baseProviderModels.filter(
          (group) => group.provider === provider && group.supportsDynamicModelFetch,
        )
      : baseProviderModels.filter((group) => group.supportsDynamicModelFetch)

    if (targetProviders.length === 0) return

    const results = await Promise.all(
      targetProviders.map(async (group): Promise<ProviderModelRefreshResult> => {
        const config = settings.providers[group.provider]
        const apiKey = config?.apiKey?.trim() || undefined
        if (group.requiresApiKey && !apiKey) {
          return { provider: group.provider, models: null }
        }

        const baseUrl = config?.baseUrl?.trim() || undefined
        try {
          const fetchedModels = await api.fetchProviderModels(group.provider, baseUrl, apiKey)
          if (fetchedModels.length === 0) {
            return { provider: group.provider, models: null }
          }

          return {
            provider: group.provider,
            models: dedupeProviderModels(group.provider, fetchedModels),
          }
        } catch {
          return { provider: group.provider, models: null }
        }
      }),
    )

    if (requestToken !== providerModelRefreshRequestToken) return

    const refreshedDynamicModels = new Map<Provider, readonly ModelDisplayInfo[]>()
    for (const result of results) {
      if (result.models && result.models.length > 0) {
        refreshedDynamicModels.set(result.provider, result.models)
      }
    }

    const latestState = get()
    const nextProviderModels = mergeProviderGroups({
      baseProviderModels: latestState.baseProviderModels,
      currentProviderModels: latestState.providerModels,
      refreshedProviders: targetProviders.map((group) => group.provider),
      refreshedDynamicModels,
    })
    set({ providerModels: nextProviderModels })
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
    void get().refreshProviderModels(provider)
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
          authMethod: existing?.authMethod,
        },
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
    void get().refreshProviderModels(provider)
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
          authMethod: existing?.authMethod,
        },
      },
    }
    await api.updateSettings({ providers: updated.providers })
    set({ settings: updated })
    void get().refreshProviderModels(provider)
  },

  async setDefaultModel(model: SupportedModelId) {
    const { settings, providerModels } = get()
    const providerInfo = providerModels.find((group) =>
      group.models.some((entry) => entry.id === model),
    )

    if (!providerInfo) {
      await api.updateSettings({ defaultModel: model })
      set({ settings: { ...settings, defaultModel: model } })
      return
    }

    const providerId = providerInfo.provider
    const existingConfig = settings.providers[providerId]
    const hasApiKey = (existingConfig?.apiKey?.trim().length ?? 0) > 0
    const canEnable = !providerInfo.requiresApiKey || hasApiKey
    const shouldEnableProvider = canEnable && !(existingConfig?.enabled ?? false)

    if (!shouldEnableProvider) {
      await api.updateSettings({ defaultModel: model })
      set({ settings: { ...settings, defaultModel: model } })
      return
    }

    const nextProviders: Settings['providers'] = {
      ...settings.providers,
      [providerId]: {
        apiKey: existingConfig?.apiKey ?? '',
        baseUrl: existingConfig?.baseUrl,
        enabled: true,
        authMethod: existingConfig?.authMethod,
      } satisfies ProviderConfig,
    }

    await api.updateSettings({ defaultModel: model, providers: nextProviders })
    set({ settings: { ...settings, defaultModel: model, providers: nextProviders } })
  },

  async toggleFavoriteModel(model: SupportedModelId) {
    const normalizedModel = model.trim()
    if (!normalizedModel) return

    const { settings } = get()
    const isFavorite = settings.favoriteModels.includes(normalizedModel)
    const favoriteModels = isFavorite
      ? settings.favoriteModels.filter((entry) => entry !== normalizedModel)
      : [
          normalizedModel,
          ...settings.favoriteModels.filter((entry) => entry !== normalizedModel),
        ].slice(0, 100)

    await api.updateSettings({ favoriteModels })
    set({ settings: { ...settings, favoriteModels } })
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
