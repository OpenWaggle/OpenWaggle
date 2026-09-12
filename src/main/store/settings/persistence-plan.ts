import type { Settings } from '@shared/types/settings'
import {
  SETTINGS_KEY_APPEARANCE_PREFERENCES,
  SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
  SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE,
  SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID,
  SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT,
  SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR,
  SETTINGS_KEY_BROWSER_LINK_TARGET,
  SETTINGS_KEY_BROWSER_PROFILES,
  SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE,
  SETTINGS_KEY_COMPACTION_THRESHOLD_PERCENT,
  SETTINGS_KEY_DEFAULT_AUTHORIZATION_MODE,
  SETTINGS_KEY_DEFAULT_MODEL,
  SETTINGS_KEY_DEFAULT_SESSION_ENVIRONMENT_MODE,
  SETTINGS_KEY_DIFF_SYNTAX_THEME,
  SETTINGS_KEY_DIFF_VIEW,
  SETTINGS_KEY_DIFF_WRAP_LINES,
  SETTINGS_KEY_ENABLE_AGENT_BROWSER_ACCESS,
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
  SETTINGS_KEY_SHORTCUT_RULES,
  SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT,
  SETTINGS_KEY_SYNTAX_THEME_SELECTIONS,
  SETTINGS_KEY_THINKING_LEVEL,
} from './keys'
import { isValidThinkingLevel } from './sanitizers'

export interface SettingsPatchWrite {
  readonly key: string
  readonly value: unknown
}

function appendChangedSetting(
  writes: SettingsPatchWrite[],
  changed: boolean,
  key: string,
  value: unknown,
) {
  if (changed) writes.push({ key, value })
}

function appendThinkingLevelWrite(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  if (partial.thinkingLevel === undefined || !isValidThinkingLevel(partial.thinkingLevel)) return
  writes.push({ key: SETTINGS_KEY_THINKING_LEVEL, value: next.thinkingLevel })
}

export function getInvalidThinkingLevel(partial: Partial<Settings>) {
  if (partial.thinkingLevel === undefined || isValidThinkingLevel(partial.thinkingLevel)) {
    return undefined
  }

  return partial.thinkingLevel
}

function appendBrowserSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.browserLinkTarget !== undefined,
    SETTINGS_KEY_BROWSER_LINK_TARGET,
    next.browserLinkTarget,
  )
  appendChangedSetting(
    writes,
    partial.browserProfiles !== undefined,
    SETTINGS_KEY_BROWSER_PROFILES,
    next.browserProfiles,
  )
  appendChangedSetting(
    writes,
    partial.browserDefaultProfileId !== undefined || partial.browserProfiles !== undefined,
    SETTINGS_KEY_BROWSER_DEFAULT_PROFILE_ID,
    next.browserDefaultProfileId,
  )
  appendChangedSetting(
    writes,
    partial.browserDefaultViewport !== undefined,
    SETTINGS_KEY_BROWSER_DEFAULT_VIEWPORT,
    next.browserDefaultViewport,
  )
  appendChangedSetting(
    writes,
    partial.browserDefaultZoomFactor !== undefined,
    SETTINGS_KEY_BROWSER_DEFAULT_ZOOM_FACTOR,
    next.browserDefaultZoomFactor,
  )
  appendChangedSetting(
    writes,
    partial.browserDefaultAppearance !== undefined,
    SETTINGS_KEY_BROWSER_DEFAULT_APPEARANCE,
    next.browserDefaultAppearance,
  )
  appendChangedSetting(
    writes,
    partial.browserRecordingFrameRate !== undefined,
    SETTINGS_KEY_BROWSER_RECORDING_FRAME_RATE,
    next.browserRecordingFrameRate,
  )
  appendChangedSetting(
    writes,
    partial.browserAutoShowFloatingPreview !== undefined,
    SETTINGS_KEY_BROWSER_AUTO_SHOW_FLOATING_PREVIEW,
    next.browserAutoShowFloatingPreview,
  )
  appendChangedSetting(
    writes,
    partial.enableAgentBrowserAccess !== undefined,
    SETTINGS_KEY_ENABLE_AGENT_BROWSER_ACCESS,
    next.enableAgentBrowserAccess,
  )
}

function appendGeneralSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.selectedModel !== undefined,
    SETTINGS_KEY_DEFAULT_MODEL,
    next.selectedModel,
  )
  appendChangedSetting(
    writes,
    partial.favoriteModels !== undefined,
    SETTINGS_KEY_FAVORITE_MODELS,
    next.favoriteModels,
  )
  appendChangedSetting(
    writes,
    partial.projectPath !== undefined,
    SETTINGS_KEY_PROJECT_PATH,
    next.projectPath,
  )
  appendThinkingLevelWrite(writes, partial, next)
  appendChangedSetting(
    writes,
    partial.recentProjects !== undefined,
    SETTINGS_KEY_RECENT_PROJECTS,
    next.recentProjects,
  )
  appendChangedSetting(
    writes,
    partial.skillTogglesByProject !== undefined,
    SETTINGS_KEY_SKILL_TOGGLES_BY_PROJECT,
    next.skillTogglesByProject,
  )
  appendChangedSetting(
    writes,
    partial.enabledModels !== undefined,
    SETTINGS_KEY_ENABLED_MODELS,
    next.enabledModels,
  )
  appendChangedSetting(
    writes,
    partial.projectDisplayNames !== undefined,
    SETTINGS_KEY_PROJECT_DISPLAY_NAMES,
    next.projectDisplayNames,
  )
  appendChangedSetting(
    writes,
    partial.shortcutBindings !== undefined || partial.shortcutRules !== undefined,
    SETTINGS_KEY_SHORTCUT_BINDINGS,
    next.shortcutBindings,
  )
  appendChangedSetting(
    writes,
    partial.shortcutBindings !== undefined || partial.shortcutRules !== undefined,
    SETTINGS_KEY_SHORTCUT_RULES,
    next.shortcutRules,
  )
  appendChangedSetting(
    writes,
    partial.defaultSessionEnvironmentMode !== undefined,
    SETTINGS_KEY_DEFAULT_SESSION_ENVIRONMENT_MODE,
    next.defaultSessionEnvironmentMode,
  )
  appendChangedSetting(
    writes,
    partial.defaultAuthorizationMode !== undefined,
    SETTINGS_KEY_DEFAULT_AUTHORIZATION_MODE,
    next.defaultAuthorizationMode,
  )
}

function appendDiffSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.diffSyntaxTheme !== undefined,
    SETTINGS_KEY_DIFF_SYNTAX_THEME,
    next.diffSyntaxTheme,
  )
  appendChangedSetting(
    writes,
    partial.syntaxThemeSelections !== undefined,
    SETTINGS_KEY_SYNTAX_THEME_SELECTIONS,
    next.syntaxThemeSelections,
  )
  appendChangedSetting(
    writes,
    partial.diffView !== undefined,
    SETTINGS_KEY_DIFF_VIEW,
    next.diffView,
  )
  appendChangedSetting(
    writes,
    partial.diffWrapLines !== undefined,
    SETTINGS_KEY_DIFF_WRAP_LINES,
    next.diffWrapLines,
  )
}

function appendSessionHostSettingsWrites(
  writes: SettingsPatchWrite[],
  partial: Partial<Settings>,
  next: Settings,
) {
  appendChangedSetting(
    writes,
    partial.sessionHostParentConcurrencyLimit !== undefined,
    SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMIT,
    next.sessionHostParentConcurrencyLimit,
  )
  appendChangedSetting(
    writes,
    partial.sessionHostParentConcurrencyLimitsByProject !== undefined,
    SETTINGS_KEY_SESSION_HOST_PARENT_CONCURRENCY_LIMITS_BY_PROJECT,
    next.sessionHostParentConcurrencyLimitsByProject,
  )
  appendChangedSetting(
    writes,
    partial.sessionHostRunCeiling !== undefined,
    SETTINGS_KEY_SESSION_HOST_RUN_CEILING,
    next.sessionHostRunCeiling,
  )
  appendChangedSetting(
    writes,
    partial.sessionHostIdleGracePeriodMs !== undefined,
    SETTINGS_KEY_SESSION_HOST_IDLE_GRACE_PERIOD_MS,
    next.sessionHostIdleGracePeriodMs,
  )
  appendChangedSetting(
    writes,
    partial.multiAgentEnabled !== undefined,
    SETTINGS_KEY_MULTI_AGENT_ENABLED,
    next.multiAgentEnabled,
  )
  appendChangedSetting(
    writes,
    partial.multiAgentEnabledByProject !== undefined,
    SETTINGS_KEY_MULTI_AGENT_ENABLED_BY_PROJECT,
    next.multiAgentEnabledByProject,
  )
}

export function collectSettingsPatchWrites(partial: Partial<Settings>, next: Settings) {
  const writes: SettingsPatchWrite[] = []

  appendGeneralSettingsWrites(writes, partial, next)
  appendDiffSettingsWrites(writes, partial, next)
  appendSessionHostSettingsWrites(writes, partial, next)
  appendChangedSetting(
    writes,
    partial.compactionThresholdPercent !== undefined,
    SETTINGS_KEY_COMPACTION_THRESHOLD_PERCENT,
    next.compactionThresholdPercent,
  )
  appendChangedSetting(
    writes,
    partial.appearancePreferences !== undefined,
    SETTINGS_KEY_APPEARANCE_PREFERENCES,
    next.appearancePreferences,
  )
  appendBrowserSettingsWrites(writes, partial, next)

  return writes
}
