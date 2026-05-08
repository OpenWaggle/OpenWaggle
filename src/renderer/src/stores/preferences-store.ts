import { SupportedModelId } from '@shared/types/brand'
import {
  DEFAULT_SETTINGS,
  type Settings,
  THINKING_LEVELS,
  type ThinkingLevel,
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
  setSelectedModel: (model: SupportedModelId) => Promise<void>
  toggleFavoriteModel: (model: SupportedModelId) => Promise<void>
  setProjectPath: (path: string | null) => Promise<void>
  pushRecentProject: (path: string) => Promise<void>
  removeRecentProject: (path: string) => Promise<void>
  setThinkingLevel: (preset: ThinkingLevel) => Promise<void>
  setEnabledModels: (models: string[]) => Promise<void>
  setProjectDisplayName: (path: string, name: string) => Promise<void>
  clearProjectDisplayName: (path: string) => Promise<void>
  loadProjectPreferences: (projectPath: string) => Promise<void>
}

/**
 * Best-effort write of project-level preferences to .openwaggle/settings.json.
 * Fire-and-forget — errors are logged since global settings are the primary store.
 */
function persistProjectPreference(
  projectPath: string | null,
  prefs: { model?: string; thinkingLevel?: string },
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
      set({ settings, isLoaded: false, loadError: null })
      if (settings.projectPath) {
        await get().loadProjectPreferences(settings.projectPath)
      }
      set({ isLoaded: true, loadError: null })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load settings'
      set({ isLoaded: true, loadError: message })
    }
  },

  async retryLoad() {
    set({ loadError: null, isLoaded: false })
    await get().loadSettings()
    const { useProviderStore } = await import('./provider-store')
    const updatedSettings = await useProviderStore.getState().loadProviderModels(get().settings)
    if (updatedSettings) {
      set({ settings: updatedSettings })
    }
  },

  async setSelectedModel(model: SupportedModelId) {
    const { settings } = get()
    await api.updateSettings({ selectedModel: model })
    set({ settings: { ...settings, selectedModel: model } })
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
      const { useProviderStore } = await import('./provider-store')
      const updatedSettings = await useProviderStore.getState().loadProviderModels(get().settings)
      if (updatedSettings) {
        set({ settings: updatedSettings })
      }
    }
  },

  async setThinkingLevel(preset: ThinkingLevel) {
    const { settings } = get()
    await api.updateSettings({ thinkingLevel: preset })
    set({ settings: { ...settings, thinkingLevel: preset } })
    persistProjectPreference(settings.projectPath, { thinkingLevel: preset })
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
    const enabledModels = models.map(SupportedModelId)
    const selectedModel = enabledModels.includes(settings.selectedModel)
      ? settings.selectedModel
      : (enabledModels[0] ?? DEFAULT_SETTINGS.selectedModel)
    await api.setEnabledModels(enabledModels)
    if (selectedModel !== settings.selectedModel) {
      await api.updateSettings({ selectedModel })
      persistProjectPreference(settings.projectPath, { model: selectedModel })
    }
    set({ settings: { ...settings, enabledModels, selectedModel } })
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
    const thinkingLevel =
      prefs.thinkingLevel && includes(THINKING_LEVELS, prefs.thinkingLevel)
        ? prefs.thinkingLevel
        : undefined

    if (!model && !thinkingLevel) return

    const merged = {
      ...settings,
      ...(model ? { selectedModel: model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    }
    await api.updateSettings({
      ...(model ? { selectedModel: model } : {}),
      ...(thinkingLevel ? { thinkingLevel } : {}),
    })
    set({ settings: merged })
  },
}))
