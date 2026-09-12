import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import {
  shortcutBindingsFromRules,
  shortcutRulesFromBindings,
  shortcutRulesWithDefaults,
} from '@shared/types/shortcuts'
import { resolveAppearancePreferences } from './appearance-preferences-sanitizer'
import {
  resolveNextBrowserSettings,
  resolveStoredBrowserSettings,
} from './browser-settings-snapshot'
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
  SETTINGS_KEY_SHORTCUT_RULES,
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
  sanitizeShortcutRules,
  sanitizeSkillTogglesByProject,
} from './sanitizers'
import {
  resolveNextSessionHostSettings,
  resolveStoredSessionHostSettings,
} from './session-host-settings-snapshot'

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
  const storedLegacyShortcutBindings = getStoredValue(
    storedSettings,
    SETTINGS_KEY_SHORTCUT_BINDINGS,
  )
  const legacyShortcutBindings = sanitizeShortcutBindings(
    storedLegacyShortcutBindings ?? DEFAULT_SETTINGS.shortcutBindings,
  )
  const storedShortcutRules = getStoredValue(storedSettings, SETTINGS_KEY_SHORTCUT_RULES)
  const sanitizedShortcutRules = sanitizeShortcutRules(storedShortcutRules)
  const shortcutRules = shortcutRulesWithDefaults(
    sanitizedShortcutRules ??
      (storedLegacyShortcutBindings === undefined
        ? DEFAULT_SETTINGS.shortcutRules
        : shortcutRulesFromBindings(legacyShortcutBindings)),
  )
  const shortcutBindings = shortcutBindingsFromRules(shortcutRules)
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
  const hostSettings = resolveStoredSessionHostSettings(storedSettings)
  const compactionThresholdPercent = resolveCompactionThresholdPercent(
    getStoredValue(storedSettings, SETTINGS_KEY_COMPACTION_THRESHOLD_PERCENT),
  )
  const appearancePreferences = resolveAppearancePreferences(
    getStoredValue(storedSettings, SETTINGS_KEY_APPEARANCE_PREFERENCES),
  )
  const browserSettings = resolveStoredBrowserSettings(storedSettings)

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
      shortcutRules,
      shortcutBindings,
      defaultSessionEnvironmentMode,
      defaultAuthorizationMode,
      diffSyntaxTheme,
      syntaxThemeSelections,
      diffView,
      diffWrapLines,
      ...hostSettings,
      compactionThresholdPercent,
      appearancePreferences,
      ...browserSettings,
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

function resolveUpdatedSetting<Input, Output>(
  candidate: Input | undefined,
  current: Output,
  resolve: (value: Input) => Output,
): Output {
  if (candidate === undefined) return current
  return resolve(candidate)
}

function resolveValidatedSetting<Value>(
  candidate: Value | undefined,
  current: Value,
  isValid: (value: Value) => boolean,
): Value {
  if (candidate === undefined) return current
  return isValid(candidate) ? candidate : current
}

function resolveNextShortcutRules(current: Settings, partial: Partial<Settings>) {
  if (partial.shortcutRules !== undefined) {
    return shortcutRulesWithDefaults(
      sanitizeShortcutRules(partial.shortcutRules) ?? current.shortcutRules,
    )
  }
  if (partial.shortcutBindings === undefined) return current.shortcutRules
  return shortcutRulesWithDefaults(
    shortcutRulesFromBindings(sanitizeShortcutBindings(partial.shortcutBindings)),
  )
}

export function buildNextSettingsSnapshot(current: Settings, partial: Partial<Settings>) {
  const coreSettings = resolveNextCoreSettings(current, partial)
  const hostSettings = resolveNextSessionHostSettings(current, partial)
  return {
    ...current,
    ...coreSettings,
    ...hostSettings,
    compactionThresholdPercent:
      partial.compactionThresholdPercent !== undefined
        ? resolveCompactionThresholdPercent(partial.compactionThresholdPercent)
        : current.compactionThresholdPercent,
    ...resolveNextDiffSettings(current, partial),
    ...resolveNextAppearanceSettings(current, partial),
    ...resolveNextBrowserSettings(current, partial),
  } satisfies Settings
}

function resolveNextCoreSettings(current: Settings, partial: Partial<Settings>) {
  const enabledModels = resolveUpdatedSetting(
    partial.enabledModels,
    current.enabledModels,
    sanitizeEnabledModels,
  )
  const selectedModel = resolveUpdatedSetting(
    partial.selectedModel,
    current.selectedModel,
    (value) => resolveSelectedModel(value, enabledModels),
  )
  const favoriteModels = resolveUpdatedSetting(
    partial.favoriteModels,
    current.favoriteModels,
    sanitizeFavoriteModels,
  )
  const projectPath = resolveUpdatedSetting(
    partial.projectPath,
    current.projectPath,
    (value) => value,
  )
  const thinkingLevel = resolveValidatedSetting(
    partial.thinkingLevel,
    current.thinkingLevel,
    isValidThinkingLevel,
  )
  const recentProjects = resolveUpdatedSetting(
    partial.recentProjects,
    current.recentProjects,
    sanitizeRecentProjects,
  )
  const skillTogglesByProject = resolveUpdatedSetting(
    partial.skillTogglesByProject,
    current.skillTogglesByProject,
    sanitizeSkillTogglesByProject,
  )
  const projectDisplayNames = resolveUpdatedSetting(
    partial.projectDisplayNames,
    current.projectDisplayNames,
    sanitizeProjectDisplayNames,
  )
  const shortcutRules = shortcutRulesWithDefaults(resolveNextShortcutRules(current, partial))
  const shortcutBindings = shortcutBindingsFromRules(shortcutRules)
  const defaultSessionEnvironmentMode = resolveValidatedSetting(
    partial.defaultSessionEnvironmentMode,
    current.defaultSessionEnvironmentMode,
    isValidSessionEnvironmentMode,
  )
  const defaultAuthorizationMode = resolveUpdatedSetting(
    partial.defaultAuthorizationMode,
    current.defaultAuthorizationMode,
    resolveDefaultAuthorizationMode,
  )
  return {
    selectedModel,
    favoriteModels,
    enabledModels,
    projectPath,
    thinkingLevel,
    recentProjects,
    skillTogglesByProject,
    projectDisplayNames,
    shortcutRules,
    shortcutBindings,
    defaultSessionEnvironmentMode,
    defaultAuthorizationMode,
  }
}
