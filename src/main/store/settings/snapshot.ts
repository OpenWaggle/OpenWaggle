import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  SETTINGS_KEY_DEFAULT_AUTHORIZATION_MODE,
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_DEFAULT_SESSION_ENVIRONMENT_MODE,
  SETTINGS_KEY_DIFF_SYNTAX_THEME,
  SETTINGS_KEY_DIFF_VIEW,
  SETTINGS_KEY_DIFF_WRAP_LINES,
  SETTINGS_KEY_ENABLED_MODELS,
  SETTINGS_KEY_FAVORITE_MODELS,
  SETTINGS_KEY_MULTI_AGENT_ENABLED,
  SETTINGS_KEY_MULTI_AGENT_ENABLED_BY_PROJECT,
  SETTINGS_KEY_PROJECT_DISPLAY_NAMES,
  SETTINGS_KEY_PROJECT_PATH,
  SETTINGS_KEY_RECENT_PROJECTS,
  SETTINGS_KEY_SESSION_HOST_IDLE_GRACE_PERIOD_MS,
  SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMIT,
  SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMITS_BY_PROJECT,
  SETTINGS_KEY_SESSION_HOST_RUN_CEILING,
  SETTINGS_KEY_SHORTCUT_BINDINGS,
  SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT,
  SETTINGS_KEY_THINKING_LEVEL,
} from './keys'
import {
  isValidDiffSyntaxTheme,
  isValidDiffView,
  isValidSessionEnvironmentMode,
  isValidThinkingLevel,
  resolveDefaultAuthorizationMode,
  resolveDefaultSessionEnvironmentMode,
  resolveDiffSyntaxTheme,
  resolveDiffView,
  resolveDiffWrapLines,
  resolveEnabledModels,
  resolveFavoriteModels,
  resolveMultiAgentEnabled,
  resolveProjectPath,
  resolveRecentProjects,
  resolveSelectedModel,
  resolveSessionHostIdleGracePeriodMs,
  resolveSessionHostParentConcurrencyLimit,
  resolveSessionHostRunCeiling,
  resolveSkillTogglesByProject,
  resolveThinkingLevel,
  sanitizeBooleanByProject,
  sanitizeEnabledModels,
  sanitizeFavoriteModels,
  sanitizePositiveIntegerByProject,
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
  const diffView = resolveDiffView(getStoredValue(storedSettings, SETTINGS_KEY_DIFF_VIEW))
  const diffWrapLines = resolveDiffWrapLines(
    getStoredValue(storedSettings, SETTINGS_KEY_DIFF_WRAP_LINES),
  )
  const sessionHostParentConcurrencyLimit = resolveSessionHostParentConcurrencyLimit(
    getStoredValue(storedSettings, SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMIT),
  )
  const sessionHostParentConcurrencyLimitsByProject = sanitizePositiveIntegerByProject(
    getStoredValue(storedSettings, SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMITS_BY_PROJECT),
  )
  const sessionHostRunCeiling = resolveSessionHostRunCeiling(
    getStoredValue(storedSettings, SETTINGS_KEY_SESSION_HOST_RUN_CEILING),
  )
  const sessionHostIdleGracePeriodMs = resolveSessionHostIdleGracePeriodMs(
    getStoredValue(storedSettings, SETTINGS_KEY_SESSION_HOST_IDLE_GRACE_PERIOD_MS),
  )
  const multiAgentEnabled = resolveMultiAgentEnabled(
    getStoredValue(storedSettings, SETTINGS_KEY_MULTI_AGENT_ENABLED),
  )
  const multiAgentEnabledByProject = sanitizeBooleanByProject(
    getStoredValue(storedSettings, SETTINGS_KEY_MULTI_AGENT_ENABLED_BY_PROJECT),
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
      diffView,
      diffWrapLines,
      sessionHostParentConcurrencyLimit,
      sessionHostParentConcurrencyLimitsByProject,
      sessionHostRunCeiling,
      sessionHostIdleGracePeriodMs,
      multiAgentEnabled,
      multiAgentEnabledByProject,
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
    diffView:
      partial.diffView !== undefined && isValidDiffView(partial.diffView)
        ? partial.diffView
        : current.diffView,
    diffWrapLines:
      typeof partial.diffWrapLines === 'boolean' ? partial.diffWrapLines : current.diffWrapLines,
  }
}

export function buildNextSettingsSnapshot(current: Settings, partial: Partial<Settings>) {
  const coreSettings = resolveNextCoreSettings(current, partial)
  const hostSettings = resolveNextSessionHostSettings(current, partial)
  return {
    ...current,
    ...coreSettings,
    ...hostSettings,
    ...resolveNextDiffSettings(current, partial),
  } satisfies Settings
}

function resolveNextCoreSettings(current: Settings, partial: Partial<Settings>) {
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
  return {
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
  }
}

function resolveNextSessionHostSettings(current: Settings, partial: Partial<Settings>) {
  const sessionHostParentConcurrencyLimit =
    partial.sessionHostParentConcurrencyLimit !== undefined
      ? resolveSessionHostParentConcurrencyLimit(partial.sessionHostParentConcurrencyLimit)
      : current.sessionHostParentConcurrencyLimit
  const sessionHostParentConcurrencyLimitsByProject =
    partial.sessionHostParentConcurrencyLimitsByProject !== undefined
      ? sanitizePositiveIntegerByProject(partial.sessionHostParentConcurrencyLimitsByProject)
      : current.sessionHostParentConcurrencyLimitsByProject
  const sessionHostRunCeiling =
    partial.sessionHostRunCeiling !== undefined
      ? resolveSessionHostRunCeiling(partial.sessionHostRunCeiling)
      : current.sessionHostRunCeiling
  const sessionHostIdleGracePeriodMs =
    partial.sessionHostIdleGracePeriodMs !== undefined
      ? resolveSessionHostIdleGracePeriodMs(partial.sessionHostIdleGracePeriodMs)
      : current.sessionHostIdleGracePeriodMs
  const multiAgentEnabled =
    partial.multiAgentEnabled !== undefined
      ? resolveMultiAgentEnabled(partial.multiAgentEnabled)
      : current.multiAgentEnabled
  const multiAgentEnabledByProject =
    partial.multiAgentEnabledByProject !== undefined
      ? sanitizeBooleanByProject(partial.multiAgentEnabledByProject)
      : current.multiAgentEnabledByProject

  return {
    sessionHostParentConcurrencyLimit,
    sessionHostParentConcurrencyLimitsByProject,
    sessionHostRunCeiling,
    sessionHostIdleGracePeriodMs,
    multiAgentEnabled,
    multiAgentEnabledByProject,
  }
}
