import type { Settings } from '@shared/types/settings'
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

export function collectSettingsPatchWrites(partial: Partial<Settings>, next: Settings) {
  const writes: SettingsPatchWrite[] = []

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
    partial.shortcutBindings !== undefined,
    SETTINGS_KEY_SHORTCUT_BINDINGS,
    next.shortcutBindings,
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

  return writes
}
