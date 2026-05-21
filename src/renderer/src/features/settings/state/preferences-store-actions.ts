import { SupportedModelId } from '@shared/types/brand'
import { DEFAULT_SETTINGS, THINKING_LEVELS, type ThinkingLevel } from '@shared/types/settings'
import { includes } from '@shared/utils/validation'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import type { PreferencesActions, PreferencesState } from './preferences-store-types'

const logger = createRendererLogger('preferences')
const SLICE_ARG_2 = 100
const SLICE_ARG_2_VALUE_10 = 10

type PreferencesSet = (
  partial: Partial<PreferencesState> | ((state: PreferencesState) => Partial<PreferencesState>),
) => void
type PreferencesGet = () => PreferencesState

function persistProjectPreference(
  projectPath: string | null,
  prefs: { model?: string; thinkingLevel?: string },
) {
  if (projectPath) {
    api.setProjectPreferences(projectPath, prefs).catch((err: unknown) => {
      logger.warn('Failed to persist project preferences', { error: String(err) })
    })
  }
}

function appendRecentProject(paths: readonly string[], path: string) {
  const normalized = path.trim()
  if (!normalized || paths.includes(normalized)) return paths
  return [...paths, normalized].slice(-SLICE_ARG_2_VALUE_10)
}

async function refreshProviderModels(set: PreferencesSet, get: PreferencesGet) {
  const { useProviderStore } = await import('@/features/providers/state')
  const updatedSettings = await useProviderStore.getState().loadProviderModels(get().settings)
  if (updatedSettings) set({ settings: updatedSettings })
}

async function loadSettings(set: PreferencesSet, get: PreferencesGet) {
  try {
    const settings = await api.getSettings()
    set({ settings, isLoaded: false, loadError: null })
    if (settings.projectPath) await get().loadProjectPreferences(settings.projectPath)
    set({ isLoaded: true, loadError: null })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load settings'
    set({ isLoaded: true, loadError: message })
  }
}

async function setProjectPath(path: string | null, set: PreferencesSet, get: PreferencesGet) {
  const { settings } = get()
  const recentProjects = path
    ? appendRecentProject(settings.recentProjects, path)
    : settings.recentProjects
  await api.updateSettings({ projectPath: path, recentProjects })
  set({ settings: { ...settings, projectPath: path, recentProjects } })
  if (path) {
    await get().loadProjectPreferences(path)
    await refreshProviderModels(set, get)
  }
}

async function setEnabledModels(models: string[], set: PreferencesSet, get: PreferencesGet) {
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
}

async function loadProjectPreferences(
  projectPath: string,
  set: PreferencesSet,
  get: PreferencesGet,
) {
  const prefs = await api.getProjectPreferences(projectPath)
  if (!prefs) return

  const { settings } = get()
  const model = prefs.model ? SupportedModelId(prefs.model) : undefined
  const thinkingLevel =
    prefs.thinkingLevel && includes(THINKING_LEVELS, prefs.thinkingLevel)
      ? prefs.thinkingLevel
      : undefined
  if (!model && !thinkingLevel) return

  const patch = {
    ...(model ? { selectedModel: model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  }
  await api.updateSettings(patch)
  set({ settings: { ...settings, ...patch } })
}

export function createPreferencesActions(
  set: PreferencesSet,
  get: PreferencesGet,
): PreferencesActions {
  return {
    loadSettings: () => loadSettings(set, get),
    retryLoad: async () => {
      set({ loadError: null, isLoaded: false })
      await get().loadSettings()
      await refreshProviderModels(set, get)
    },
    setSelectedModel: async (model) => {
      const { settings } = get()
      await api.updateSettings({ selectedModel: model })
      set({ settings: { ...settings, selectedModel: model } })
      persistProjectPreference(settings.projectPath, { model })
    },
    toggleFavoriteModel: async (model) => {
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
    setProjectPath: (path) => setProjectPath(path, set, get),
    pushRecentProject: async (path) => {
      const normalized = path.trim()
      if (!normalized) return
      const { settings } = get()
      const recentProjects = appendRecentProject(settings.recentProjects, normalized)
      await api.updateSettings({ recentProjects })
      set({ settings: { ...settings, recentProjects } })
    },
    removeRecentProject: async (path) => {
      const { settings } = get()
      const recentProjects = settings.recentProjects.filter((project) => project !== path)
      await api.updateSettings({ recentProjects })
      set({ settings: { ...settings, recentProjects } })
    },
    setThinkingLevel: async (preset: ThinkingLevel) => {
      const { settings } = get()
      await api.updateSettings({ thinkingLevel: preset })
      set({ settings: { ...settings, thinkingLevel: preset } })
      persistProjectPreference(settings.projectPath, { thinkingLevel: preset })
    },
    setEnabledModels: (models) => setEnabledModels(models, set, get),
    setProjectDisplayName: async (path, name) => {
      const { settings } = get()
      const projectDisplayNames = { ...settings.projectDisplayNames, [path]: name }
      await api.updateSettings({ projectDisplayNames })
      set({ settings: { ...settings, projectDisplayNames } })
    },
    clearProjectDisplayName: async (path) => {
      const { settings } = get()
      const { [path]: _ignored, ...projectDisplayNames } = settings.projectDisplayNames
      await api.updateSettings({ projectDisplayNames })
      set({ settings: { ...settings, projectDisplayNames } })
    },
    removeProjectReferences: async (path) => {
      const { settings } = get()
      const recentProjects = settings.recentProjects.filter((projectPath) => projectPath !== path)
      const { [path]: _displayName, ...projectDisplayNames } = settings.projectDisplayNames
      const { [path]: _skillToggles, ...skillTogglesByProject } = settings.skillTogglesByProject
      const projectPath = settings.projectPath === path ? null : settings.projectPath
      await api.updateSettings({
        projectPath,
        recentProjects,
        projectDisplayNames,
        skillTogglesByProject,
      })
      set({
        settings: {
          ...settings,
          projectPath,
          recentProjects,
          projectDisplayNames,
          skillTogglesByProject,
        },
      })
    },
    loadProjectPreferences: (projectPath) => loadProjectPreferences(projectPath, set, get),
  }
}
