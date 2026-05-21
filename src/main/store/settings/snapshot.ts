import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_ENABLED_MODELS,
  SETTINGS_KEY_FAVORITE_MODELS,
  SETTINGS_KEY_PROJECT_DISPLAY_NAMES,
  SETTINGS_KEY_PROJECT_PATH,
  SETTINGS_KEY_RECENT_PROJECTS,
  SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT,
  SETTINGS_KEY_THINKING_LEVEL,
} from './keys'
import {
  isValidThinkingLevel,
  resolveEnabledModels,
  resolveFavoriteModels,
  resolveProjectPath,
  resolveRecentProjects,
  resolveSelectedModel,
  resolveSkillTogglesByProject,
  resolveThinkingLevel,
  sanitizeEnabledModels,
  sanitizeFavoriteModels,
  sanitizeProjectDisplayNames,
  sanitizeRecentProjects,
  sanitizeSkillTogglesByProject,
} from './sanitizers'

export function createDefaultSettingsSnapshot() {
  return {
    ...DEFAULT_SETTINGS,
  }
}

function getStoredValue(storedSettings: Readonly<Record<string, unknown>>, key: string) {
  return Object.hasOwn(storedSettings, key) ? storedSettings[key] : undefined
}

export function buildSettingsSnapshot(storedSettings: Readonly<Record<string, unknown>>) {
  const thinkingLevel = resolveThinkingLevel(
    getStoredValue(storedSettings, SETTINGS_KEY_THINKING_LEVEL),
  )
  const favoriteModels = resolveFavoriteModels(
    getStoredValue(storedSettings, SETTINGS_KEY_FAVORITE_MODELS),
  )
  const recentProjects = resolveRecentProjects(
    getStoredValue(storedSettings, SETTINGS_KEY_RECENT_PROJECTS),
  )
  const skillTogglesByProject = resolveSkillTogglesByProject(
    getStoredValue(storedSettings, SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT),
  )
  const enabledModels = resolveEnabledModels(
    getStoredValue(storedSettings, SETTINGS_KEY_ENABLED_MODELS),
  )
  const selectedModel = resolveSelectedModel(
    getStoredValue(storedSettings, SETTINGS_KEY_DEFAULT_MODEL),
    enabledModels,
  )
  const projectDisplayNames = sanitizeProjectDisplayNames(
    getStoredValue(storedSettings, SETTINGS_KEY_PROJECT_DISPLAY_NAMES) ??
      DEFAULT_SETTINGS.projectDisplayNames,
  )

  return {
    settings: {
      selectedModel,
      favoriteModels,
      enabledModels,
      projectPath: resolveProjectPath(getStoredValue(storedSettings, SETTINGS_KEY_PROJECT_PATH)),
      thinkingLevel,
      recentProjects,
      skillTogglesByProject,
      projectDisplayNames,
    } satisfies Settings,
  }
}

export function buildNextSettingsSnapshot(current: Settings, partial: Partial<Settings>) {
  const enabledModels =
    partial.enabledModels !== undefined
      ? sanitizeEnabledModels(partial.enabledModels)
      : current.enabledModels
  const selectedModel =
    partial.selectedModel !== undefined
      ? resolveSelectedModel(partial.selectedModel, enabledModels)
      : current.selectedModel
  const favoriteModels =
    partial.favoriteModels !== undefined
      ? sanitizeFavoriteModels(partial.favoriteModels)
      : current.favoriteModels
  const projectPath = partial.projectPath !== undefined ? partial.projectPath : current.projectPath
  const thinkingLevel =
    partial.thinkingLevel !== undefined && isValidThinkingLevel(partial.thinkingLevel)
      ? partial.thinkingLevel
      : current.thinkingLevel
  const recentProjects =
    partial.recentProjects !== undefined
      ? sanitizeRecentProjects(partial.recentProjects)
      : current.recentProjects
  const skillTogglesByProject =
    partial.skillTogglesByProject !== undefined
      ? sanitizeSkillTogglesByProject(partial.skillTogglesByProject)
      : current.skillTogglesByProject
  const projectDisplayNames =
    partial.projectDisplayNames !== undefined
      ? sanitizeProjectDisplayNames(partial.projectDisplayNames)
      : current.projectDisplayNames

  return {
    ...current,
    selectedModel,
    favoriteModels,
    enabledModels,
    projectPath,
    thinkingLevel,
    recentProjects,
    skillTogglesByProject,
    projectDisplayNames,
  } satisfies Settings
}
