import { SupportedModelId } from '@shared/types/brand'
import {
  DEFAULT_SETTINGS,
  type ExecutionMode,
  type ProviderConfig,
  QUALITY_PRESETS,
  type QualityPreset,
  type Settings,
} from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { create } from 'zustand'
import { api } from '@/lib/ipc'
import { createRendererLogger } from '@/lib/logger'

const logger = createRendererLogger('preferences')

const SLICE_ARG_2 = 100
const SLICE_ARG_2_VALUE_10 = 10

interface PreferencesState {
  settings: Settings
  isLoaded: boolean
  loadError: string | null

  loadSettings: () => Promise<void>
  retryLoad: () => Promise<void>
  setDefaultModel: (
    model: SupportedModelId,
    authMethod?: 'api-key' | 'subscription',
  ) => Promise<void>
  toggleFavoriteModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  pushRecentProject: (path: string) => Promise<void>
  removeRecentProject: (path: string) => Promise<void>
  setExecutionMode: (mode: ExecutionMode) => Promise<void>
  setQualityPreset: (preset: QualityPreset) => Promise<void>
  setEnabledModels: (models: string[]) => Promise<void>
  setProjectDisplayName: (path: string, name: string) => Promise<void>
  clearProjectDisplayName: (path: string) => Promise<void>
  loadProjectPreferences: (projectPath: string) => Promise<void>
}

/**
 * Best-effort write of project-level preferences to config.local.toml.
 * Fire-and-forget — errors are silently caught since global settings are the primary store.
 */
function persistProjectPreference(
  projectPath: string | null,
  prefs: { model?: string; qualityPreset?: string },
): void {
  if (projectPath) {
    api.setProjectPreferences(projectPath, prefs).catch((err: unknown) => {
      logger.warn('Failed to persist project preferences', { error: String(err) })
    })
  }
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  isLoaded: false,
  loadError: null,

  async loadSettings() {
    try {
      const settings = await api.getSettings()
      set({ settings, isLoaded: true, loadError: null })
      if (settings.projectPath) {
        get()
          .loadProjectPreferences(settings.projectPath)
          .catch((err: unknown) => {
            logger.warn('Failed to load project preferences', { error: String(err) })
          })
      }
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

  async setDefaultModel(model: SupportedModelId, authMethod?: 'api-key' | 'subscription') {
    const { useProviderStore } = await import('./provider-store')
    const { settings } = get()
    const { providerModels } = useProviderStore.getState()
    const providerInfo = providerModels.find((group) =>
      group.models.some((entry) => entry.id === model),
    )

    if (!providerInfo) {
      await api.updateSettings({ defaultModel: model })
      set({ settings: { ...settings, defaultModel: model } })
      persistProjectPreference(settings.projectPath, { model })
      return
    }

    const providerId = providerInfo.provider
    const existingConfig = settings.providers[providerId]
    const hasApiKey = (existingConfig?.apiKey?.trim().length ?? 0) > 0
    const canEnable = !providerInfo.requiresApiKey || hasApiKey
    const shouldEnableProvider = canEnable && !(existingConfig?.enabled ?? false)

    // Switch authMethod if the user selected a model from a different connection
    const needsAuthSwitch = authMethod !== undefined && existingConfig?.authMethod !== authMethod

    if (!shouldEnableProvider && !needsAuthSwitch) {
      await api.updateSettings({ defaultModel: model })
      set({ settings: { ...settings, defaultModel: model } })
      persistProjectPreference(settings.projectPath, { model })
      return
    }

    const nextProviders: Settings['providers'] = {
      ...settings.providers,
      [providerId]: {
        apiKey: existingConfig?.apiKey ?? '',
        baseUrl: existingConfig?.baseUrl,
        enabled: true,
        authMethod: needsAuthSwitch ? authMethod : existingConfig?.authMethod,
      } satisfies ProviderConfig,
    }

    await api.updateSettings({ defaultModel: model, providers: nextProviders })
    set({ settings: { ...settings, defaultModel: model, providers: nextProviders } })
    persistProjectPreference(settings.projectPath, { model })
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
        ].slice(0, SLICE_ARG_2)

    await api.updateSettings({ favoriteModels })
    set({ settings: { ...settings, favoriteModels } })
  },

  async setProjectPath(path: string | null) {
    const { settings } = get()
    let recentProjects = settings.recentProjects
    if (path) {
      const deduped = [path, ...settings.recentProjects.filter((p) => p !== path)]
      recentProjects = deduped.slice(0, SLICE_ARG_2_VALUE_10)
    }
    await api.updateSettings({ projectPath: path, recentProjects })
    set({ settings: { ...settings, projectPath: path, recentProjects } })
    if (path) {
      await get().loadProjectPreferences(path)
    }
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
    persistProjectPreference(settings.projectPath, { qualityPreset: preset })
  },

  async pushRecentProject(path: string) {
    const normalized = path.trim()
    if (!normalized) return

    const { settings } = get()
    const recentProjects = [
      normalized,
      ...settings.recentProjects.filter((p) => p !== normalized),
    ].slice(0, SLICE_ARG_2_VALUE_10)
    await api.updateSettings({ recentProjects })
    set({ settings: { ...settings, recentProjects } })
  },

  async removeRecentProject(path: string) {
    const { settings } = get()
    const recentProjects = settings.recentProjects.filter((p) => p !== path)
    await api.updateSettings({ recentProjects })
    set({ settings: { ...settings, recentProjects } })
  },

  async setEnabledModels(models: string[]) {
    const { settings } = get()
    await api.setEnabledModels(models)
    set({ settings: { ...settings, enabledModels: models } })
  },

  async setProjectDisplayName(path: string, name: string) {
    const { settings } = get()
    const projectDisplayNames = { ...settings.projectDisplayNames, [path]: name }
    await api.updateSettings({ projectDisplayNames })
    set({ settings: { ...settings, projectDisplayNames } })
  },

  async clearProjectDisplayName(path: string) {
    const { settings } = get()
    const { [path]: _, ...rest } = settings.projectDisplayNames
    await api.updateSettings({ projectDisplayNames: rest })
    set({ settings: { ...settings, projectDisplayNames: rest } })
  },

  async loadProjectPreferences(projectPath: string) {
    const prefs = await api.getProjectPreferences(projectPath)
    if (!prefs) return

    const { settings } = get()
    const model = prefs.model ? SupportedModelId(prefs.model) : undefined
    const qualityPreset =
      prefs.qualityPreset && includes(QUALITY_PRESETS, prefs.qualityPreset)
        ? prefs.qualityPreset
        : undefined

    if (!model && !qualityPreset) return

    const merged = {
      ...settings,
      ...(model ? { defaultModel: model } : {}),
      ...(qualityPreset ? { qualityPreset } : {}),
    }
    await api.updateSettings({
      ...(model ? { defaultModel: model } : {}),
      ...(qualityPreset ? { qualityPreset } : {}),
    })
    set({ settings: merged })
  },
}))
