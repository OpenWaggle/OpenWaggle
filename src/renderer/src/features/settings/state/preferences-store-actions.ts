import type { AgentAuthorizationMode } from '@shared/types/agent-authorization'
import { SupportedModelId } from '@shared/types/brand'
import type { SessionEnvironmentMode } from '@shared/types/git'
import {
  DEFAULT_SETTINGS,
  type DiffSyntaxTheme,
  type DiffView,
  type Settings,
  THINKING_LEVELS,
  type ThinkingLevel,
} from '@shared/types/settings'
import type { ShortcutBinding, ShortcutBindings, ShortcutCommand } from '@shared/types/shortcuts'
import { includes } from '@shared/utils/validation'
import { useProviderStore } from '@/features/providers/state'
import { setRuntimeAppearancePreferences } from '@/shared/lib/appearance-preferences-runtime'
import { api } from '@/shared/lib/ipc'
import { createRendererLogger } from '@/shared/lib/logger'
import { setRuntimeSyntaxThemeSelections } from '@/shared/lib/syntax/syntax-theme-runtime'
import {
  persistAppearanceMotion,
  persistAppearanceTypography,
} from './appearance-preferences-actions'
import type { PreferencesActions, PreferencesGet, PreferencesSet } from './preferences-store-types'

const logger = createRendererLogger('preferences')
const SLICE_ARG_2 = 100
const SLICE_ARG_2_VALUE_10 = 10

function mergeSettings(set: PreferencesSet, patch: Partial<Settings>) {
  set((state) => ({ settings: { ...state.settings, ...patch } }))
}

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
  const updatedSettings = await useProviderStore.getState().loadProviderModels(get().settings)
  if (updatedSettings) {
    mergeSettings(set, {
      enabledModels: updatedSettings.enabledModels,
      selectedModel: updatedSettings.selectedModel,
    })
  }
}

async function loadSettings(set: PreferencesSet, get: PreferencesGet) {
  try {
    const settings = await api.getSettings()
    setRuntimeSyntaxThemeSelections(settings.syntaxThemeSelections)
    setRuntimeAppearancePreferences(settings.appearancePreferences)
    set({
      settings,
      persistedAppearancePreferences: settings.appearancePreferences,
      isLoaded: false,
      loadError: null,
    })
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
  mergeSettings(set, { projectPath: path, recentProjects })
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
  mergeSettings(set, { enabledModels, selectedModel })
}

async function loadProjectPreferences(projectPath: string, set: PreferencesSet) {
  const prefs = await api.getProjectPreferences(projectPath)
  if (!prefs) return

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
  mergeSettings(set, patch)
}

async function persistShortcutBindings(shortcutBindings: ShortcutBindings, set: PreferencesSet) {
  const result = await api.updateSettings({ shortcutBindings })
  if (!result.ok) throw new Error(result.error)

  const persistedSettings = await api.getSettings()
  mergeSettings(set, { shortcutBindings: persistedSettings.shortcutBindings })
}

/** Persists one scalar setting and mirrors it into the store. */
async function persistSetting<K extends keyof Settings>(
  key: K,
  value: Settings[K],
  set: PreferencesSet,
) {
  await api.updateSettings({ [key]: value })
  mergeSettings(set, { [key]: value })
}

function assertSettingsUpdateSucceeded(result: Awaited<ReturnType<typeof api.updateSettings>>) {
  if (!result.ok) throw new Error(result.error)
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
      mergeSettings(set, { selectedModel: model })
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
      mergeSettings(set, { favoriteModels })
    },
    setProjectPath: (path) => setProjectPath(path, set, get),
    pushRecentProject: async (path) => {
      const normalized = path.trim()
      if (!normalized) return
      const { settings } = get()
      const recentProjects = appendRecentProject(settings.recentProjects, normalized)
      await api.updateSettings({ recentProjects })
      mergeSettings(set, { recentProjects })
    },
    removeRecentProject: async (path) => {
      const { settings } = get()
      const recentProjects = settings.recentProjects.filter((project) => project !== path)
      await api.updateSettings({ recentProjects })
      mergeSettings(set, { recentProjects })
    },
    setThinkingLevel: async (preset: ThinkingLevel) => {
      const { settings } = get()
      await api.updateSettings({ thinkingLevel: preset })
      mergeSettings(set, { thinkingLevel: preset })
      persistProjectPreference(settings.projectPath, { thinkingLevel: preset })
    },
    setDefaultAuthorizationMode: (mode: AgentAuthorizationMode) =>
      persistSetting('defaultAuthorizationMode', mode, set),
    setDefaultSessionEnvironmentMode: (mode: SessionEnvironmentMode) =>
      persistSetting('defaultSessionEnvironmentMode', mode, set),
    setDiffSyntaxTheme: (theme: DiffSyntaxTheme) => persistSetting('diffSyntaxTheme', theme, set),
    setSyntaxTheme: async (variant, themeId) => {
      const { settings } = get()
      const syntaxThemeSelections = {
        ...settings.syntaxThemeSelections,
        [variant]: themeId,
      }
      assertSettingsUpdateSucceeded(await api.updateSettings({ syntaxThemeSelections }))
      setRuntimeSyntaxThemeSelections(syntaxThemeSelections)
      mergeSettings(set, { syntaxThemeSelections })
    },
    setDiffView: (view: DiffView) => persistSetting('diffView', view, set),
    setDiffWrapLines: (wrap: boolean) => persistSetting('diffWrapLines', wrap, set),
    setAppearanceTypography: (typography) => persistAppearanceTypography(typography, set, get),
    setAppearanceMotion: (motion) => persistAppearanceMotion(motion, set, get),
    setEnabledModels: (models) => setEnabledModels(models, set, get),
    setProjectDisplayName: async (path, name) => {
      const { settings } = get()
      const projectDisplayNames = { ...settings.projectDisplayNames, [path]: name }
      await api.updateSettings({ projectDisplayNames })
      mergeSettings(set, { projectDisplayNames })
    },
    setShortcutBinding: async (command: ShortcutCommand, binding: ShortcutBinding | null) => {
      const { settings } = get()
      const shortcutBindings = { ...settings.shortcutBindings, [command]: binding }
      await persistShortcutBindings(shortcutBindings, set)
    },
    resetShortcutBindings: async () => {
      await persistShortcutBindings(DEFAULT_SETTINGS.shortcutBindings, set)
    },
    clearProjectDisplayName: async (path) => {
      const { settings } = get()
      const { [path]: _ignored, ...projectDisplayNames } = settings.projectDisplayNames
      await api.updateSettings({ projectDisplayNames })
      mergeSettings(set, { projectDisplayNames })
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
      mergeSettings(set, {
        projectPath,
        recentProjects,
        projectDisplayNames,
        skillTogglesByProject,
      })
    },
    loadProjectPreferences: (projectPath) => loadProjectPreferences(projectPath, set),
  }
}
