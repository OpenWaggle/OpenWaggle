import { SupportedModelId } from '@shared/types/brand'
import {
  DEFAULT_SETTINGS,
  type ExecutionMode,
  type ProviderConfig,
  type QualityPreset,
  type Settings,
} from '@shared/types/settings'
import { create } from 'zustand'
import { api } from '@/lib/ipc'

interface PreferencesState {
  settings: Settings
  isLoaded: boolean
  loadError: string | null

  loadSettings: () => Promise<void>
  retryLoad: () => Promise<void>
  setDefaultModel: (model: SupportedModelId) => Promise<void>
  toggleFavoriteModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  pushRecentProject: (path: string) => Promise<void>
  setExecutionMode: (mode: ExecutionMode) => Promise<void>
  setQualityPreset: (preset: QualityPreset) => Promise<void>
  setBrowserHeadless: (headless: boolean) => Promise<void>
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  loadError: null,

  async loadSettings() {
    try {
      const settings = await api.getSettings()
      set({ settings, isLoaded: true, loadError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      set({ isLoaded: true, loadError: message })
    }
  },

  async retryLoad() {
    set({ loadError: null, isLoaded: false })
    await get().loadSettings()
    // Dynamically import to avoid circular dependency at module load time
    const { useProviderStore } = await import('./provider-store')
    await useProviderStore.getState().loadProviderModels()
  },

  async setDefaultModel(model: SupportedModelId) {
    const { useProviderStore } = await import('./provider-store')
    const { settings } = get()
    const { providerModels } = useProviderStore.getState()
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
    const trimmed = model.trim()
    if (!trimmed) return
    const normalizedModel = SupportedModelId(trimmed)

    const { settings } = get()
    const isFavorite = settings.favoriteModels.includes(normalizedModel)
    const favoriteModels: SupportedModelId[] = isFavorite
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
}))
