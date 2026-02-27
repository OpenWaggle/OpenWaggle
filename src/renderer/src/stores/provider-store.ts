import { SupportedModelId } from '@shared/types/brand'
import type { ModelDisplayInfo, ProviderInfo } from '@shared/types/llm'
import type { Provider, ProviderConfig, Settings } from '@shared/types/settings'
import { isValidBaseUrl } from '@shared/utils/validation'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface ProviderModelRefreshResult {
  readonly provider: Provider
  readonly models: ModelDisplayInfo[] | null
  readonly error?: string
}

const providerModelRefreshTokens: Partial<Record<Provider, number>> = {}

function issueProviderRefreshTokens(providers: readonly Provider[]): Map<Provider, number> {
  const expectedTokens = new Map<Provider, number>()

  for (const provider of providers) {
    const nextToken = (providerModelRefreshTokens[provider] ?? 0) + 1
    providerModelRefreshTokens[provider] = nextToken
    expectedTokens.set(provider, nextToken)
  }

  return expectedTokens
}

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
      id: SupportedModelId(normalizedId),
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

interface ProviderState {
  baseProviderModels: ProviderInfo[]
  providerModels: ProviderInfo[]
  modelFetchErrors: Partial<Record<Provider, string>>
  testingProviders: Partial<Record<Provider, boolean>>
  testResults: Partial<Record<Provider, { success: boolean; error?: string } | null>>

  loadProviderModels: () => Promise<void>
  refreshProviderModels: (provider?: Provider) => Promise<void>
  updateApiKey: (provider: Provider, apiKey: string) => Promise<void>
  toggleProvider: (provider: Provider, enabled: boolean) => Promise<void>
  updateBaseUrl: (provider: Provider, baseUrl: string) => Promise<void>
  testApiKey: (provider: Provider, apiKey: string, baseUrl?: string) => Promise<boolean>
  clearTestResult: (provider: Provider) => void
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  baseProviderModels: [],
  providerModels: [],
  modelFetchErrors: {},
  testingProviders: {},
  testResults: {},

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
    const { usePreferencesStore } = await import('./preferences-store')
    const { baseProviderModels } = get()
    const { settings } = usePreferencesStore.getState()
    const targetProviders = provider
      ? baseProviderModels.filter(
          (group) => group.provider === provider && group.supportsDynamicModelFetch,
        )
      : baseProviderModels.filter((group) => group.supportsDynamicModelFetch)

    if (targetProviders.length === 0) return
    const targetProviderIds = targetProviders.map((group) => group.provider)
    const expectedTokens = issueProviderRefreshTokens(targetProviderIds)

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
        } catch (err) {
          return {
            provider: group.provider,
            models: null,
            error: err instanceof Error ? err.message : 'Failed to fetch models',
          }
        }
      }),
    )
    const freshProviderIds = targetProviderIds.filter(
      (providerId) => providerModelRefreshTokens[providerId] === expectedTokens.get(providerId),
    )
    if (freshProviderIds.length === 0) return
    const freshProviderSet = new Set(freshProviderIds)

    const refreshedDynamicModels = new Map<Provider, readonly ModelDisplayInfo[]>()
    for (const result of results) {
      if (freshProviderSet.has(result.provider) && result.models && result.models.length > 0) {
        refreshedDynamicModels.set(result.provider, result.models)
      }
    }

    const latestState = get()
    const nextProviderModels = mergeProviderGroups({
      baseProviderModels: latestState.baseProviderModels,
      currentProviderModels: latestState.providerModels,
      refreshedProviders: freshProviderIds,
      refreshedDynamicModels,
    })

    const nextErrors: Partial<Record<Provider, string>> = { ...latestState.modelFetchErrors }
    for (const result of results) {
      if (!freshProviderSet.has(result.provider)) continue
      if (result.error) {
        nextErrors[result.provider] = result.error
      } else {
        delete nextErrors[result.provider]
      }
    }

    set({ providerModels: nextProviderModels, modelFetchErrors: nextErrors })
  },

  async updateApiKey(provider: Provider, apiKey: string) {
    const { usePreferencesStore } = await import('./preferences-store')
    const normalizedApiKey = apiKey.trim()

    const { settings } = usePreferencesStore.getState()
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
    usePreferencesStore.setState({ settings: updated })
    void get().refreshProviderModels(provider)
  },

  async toggleProvider(provider: Provider, enabled: boolean) {
    const { usePreferencesStore } = await import('./preferences-store')
    const { settings } = usePreferencesStore.getState()
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
    usePreferencesStore.setState({ settings: updated })
    void get().refreshProviderModels(provider)
  },

  async updateBaseUrl(provider: Provider, baseUrl: string) {
    const { usePreferencesStore } = await import('./preferences-store')
    const normalizedBaseUrl = baseUrl.trim()
    if (normalizedBaseUrl && !isValidBaseUrl(normalizedBaseUrl)) return

    const { settings } = usePreferencesStore.getState()
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
    usePreferencesStore.setState({ settings: updated })
    void get().refreshProviderModels(provider)
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
}))
