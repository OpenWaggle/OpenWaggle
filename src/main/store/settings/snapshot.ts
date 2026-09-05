import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import { resolveAppearancePreferences } from './appearance-preferences-sanitizer'
import {
  SETTINGS_KEY_APPEARANCE_PREFERENCES,
  SETTINGS_KEY_COMPACTION_THRESHOLD_PERCENT,
  SETTINGS_KEY_DEFAULT_AUTHORIZATION_MODE,
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_DEFAULT_SESSION_ENVIRONMENT_MODE,
  SETTINGS_KEY_DIFF_SYNTAX_THEME,
  SETTINGS_KEY_DIFF_VIEW,
  SETTINGS_KEY_DIFF_WRAP_LINES,
  SETTINGS_KEY_ENABLED_MODELS,
  SETTINGS_KEY_FAVORITE_MODELS,
  SETTINGS_KEY_PROJECT_DISPLAY_NAMES,
  SETTINGS_KEY_PROJECT_PATH,
  SETTINGS_KEY_RECENT_PROJECTS,
  SETTINGS_KEY_SHORTCUT_BINDINGS,
  SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT,
  SETTINGS_KEY_SYNTAX_THEME_SELECTIONS,
  SETTINGS_KEY_THINKING_LEVEL,
} from './keys'
import {
  isValidDiffSyntaxTheme,
  isValidDiffView,
  isValidSessionEnvironmentMode,
  isValidThinkingLevel,
  resolveCompactionThresholdPercent,
  resolveDefaultAuthorizationMode,
  resolveDefaultSessionEnvironmentMode,
  resolveDiffSyntaxTheme,
  resolveDiffView,
  resolveDiffWrapLines,
  resolveEnabledModels,
  resolveFavoriteModels,
  resolveProjectPath,
  resolveRecentProjects,
  resolveSelectedModel,
  resolveSkillTogglesByProject,
  resolveSyntaxThemeSelections,
  resolveThinkingLevel,
  sanitizeEnabledModels,
  sanitizeFavoriteModels,
  sanitizeProjectDisplayNames,
  sanitizeRecentProjects,
  sanitizeShortcutBindings,
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
  const shortcutBindings = sanitizeShortcutBindings(
    getStoredValue(storedSettings, SETTINGS_KEY_SHORTCUT_BINDINGS) ??
      DEFAULT_SETTINGS.shortcutBindings,
  )
  const defaultSessionEnvironmentMode = resolveDefaultSessionEnvironmentMode(
    getStoredValue(storedSettings, SETTINGS_KEY_DEFAULT_SESSION_ENVIRONMENT_MODE),
  )
  const defaultAuthorizationMode = resolveDefaultAuthorizationMode(
    getStoredValue(storedSettings, SETTINGS_KEY_DEFAULT_AUTHORIZATION_MODE),
  )
  const diffSyntaxTheme = resolveDiffSyntaxTheme(
    getStoredValue(storedSettings, SETTINGS_KEY_DIFF_SYNTAX_THEME),
  )
  const syntaxThemeSelections = resolveSyntaxThemeSelections(
    getStoredValue(storedSettings, SETTINGS_KEY_SYNTAX_THEME_SELECTIONS),
  )
  const diffView = resolveDiffView(getStoredValue(storedSettings, SETTINGS_KEY_DIFF_VIEW))
  const diffWrapLines = resolveDiffWrapLines(
    getStoredValue(storedSettings, SETTINGS_KEY_DIFF_WRAP_LINES),
  )
  const compactionThresholdPercent = resolveCompactionThresholdPercent(
    getStoredValue(storedSettings, SETTINGS_KEY_COMPACTION_THRESHOLD_PERCENT),
  )
  const appearancePreferences = resolveAppearancePreferences(
    getStoredValue(storedSettings, SETTINGS_KEY_APPEARANCE_PREFERENCES),
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
      shortcutBindings,
      defaultSessionEnvironmentMode,
      defaultAuthorizationMode,
      diffSyntaxTheme,
      syntaxThemeSelections,
      diffView,
      diffWrapLines,
      compactionThresholdPercent,
      appearancePreferences,
    } satisfies Settings,
  }
}

/** Diff view preferences, split out to keep buildNextSettingsSnapshot within complexity limits. */
function resolveNextDiffSettings(current: Settings, partial: Partial<Settings>) {
  return {
    diffSyntaxTheme:
      partial.diffSyntaxTheme !== undefined && isValidDiffSyntaxTheme(partial.diffSyntaxTheme)
        ? partial.diffSyntaxTheme
        : current.diffSyntaxTheme,
    syntaxThemeSelections:
      partial.syntaxThemeSelections !== undefined
        ? resolveSyntaxThemeSelections(partial.syntaxThemeSelections)
        : current.syntaxThemeSelections,
    diffView:
      partial.diffView !== undefined && isValidDiffView(partial.diffView)
        ? partial.diffView
        : current.diffView,
    diffWrapLines:
      typeof partial.diffWrapLines === 'boolean' ? partial.diffWrapLines : current.diffWrapLines,
  }
}

function resolveNextAppearanceSettings(current: Settings, partial: Partial<Settings>) {
  return {
    appearancePreferences:
      partial.appearancePreferences !== undefined
        ? resolveAppearancePreferences(partial.appearancePreferences)
        : current.appearancePreferences,
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
  const shortcutBindings =
    partial.shortcutBindings !== undefined
      ? sanitizeShortcutBindings(partial.shortcutBindings)
      : current.shortcutBindings
  const defaultSessionEnvironmentMode =
    partial.defaultSessionEnvironmentMode !== undefined &&
    isValidSessionEnvironmentMode(partial.defaultSessionEnvironmentMode)
      ? partial.defaultSessionEnvironmentMode
      : current.defaultSessionEnvironmentMode
  const defaultAuthorizationMode =
    partial.defaultAuthorizationMode !== undefined
      ? resolveDefaultAuthorizationMode(partial.defaultAuthorizationMode)
      : current.defaultAuthorizationMode
  const diffSettings = resolveNextDiffSettings(current, partial)
  const compactionThresholdPercent =
    partial.compactionThresholdPercent !== undefined
      ? resolveCompactionThresholdPercent(partial.compactionThresholdPercent)
      : current.compactionThresholdPercent
  const appearanceSettings = resolveNextAppearanceSettings(current, partial)

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
    shortcutBindings,
    defaultSessionEnvironmentMode,
    defaultAuthorizationMode,
    ...diffSettings,
    compactionThresholdPercent,
    ...appearanceSettings,
  } satisfies Settings
}
