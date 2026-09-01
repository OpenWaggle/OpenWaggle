import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SettingsService } from '../../services/settings-service'

function mergeGeneralSettings(current: Settings, partial: Partial<Settings>) {
  return {
    selectedModel: partial.selectedModel ?? current.selectedModel,
    favoriteModels: partial.favoriteModels ?? current.favoriteModels,
    enabledModels: partial.enabledModels ?? current.enabledModels,
    projectPath: partial.projectPath !== undefined ? partial.projectPath : current.projectPath,
    thinkingLevel: partial.thinkingLevel ?? current.thinkingLevel,
    recentProjects: partial.recentProjects ?? current.recentProjects,
    skillTogglesByProject: partial.skillTogglesByProject ?? current.skillTogglesByProject,
    projectDisplayNames: partial.projectDisplayNames ?? current.projectDisplayNames,
    defaultAuthorizationMode: partial.defaultAuthorizationMode ?? current.defaultAuthorizationMode,
    shortcutBindings: partial.shortcutBindings ?? current.shortcutBindings,
    defaultSessionEnvironmentMode:
      partial.defaultSessionEnvironmentMode ?? current.defaultSessionEnvironmentMode,
  }
}

function mergeSessionHostSettings(current: Settings, partial: Partial<Settings>) {
  return {
    sessionHostParentConcurrencyLimit:
      partial.sessionHostParentConcurrencyLimit ?? current.sessionHostParentConcurrencyLimit,
    sessionHostParentConcurrencyLimitsByProject:
      partial.sessionHostParentConcurrencyLimitsByProject ??
      current.sessionHostParentConcurrencyLimitsByProject,
    sessionHostRunCeiling: partial.sessionHostRunCeiling ?? current.sessionHostRunCeiling,
    sessionHostIdleGracePeriodMs:
      partial.sessionHostIdleGracePeriodMs ?? current.sessionHostIdleGracePeriodMs,
    multiAgentEnabled: partial.multiAgentEnabled ?? current.multiAgentEnabled,
    multiAgentEnabledByProject:
      partial.multiAgentEnabledByProject ?? current.multiAgentEnabledByProject,
  }
}

function mergeAppearanceSettings(current: Settings, partial: Partial<Settings>) {
  return {
    diffSyntaxTheme: partial.diffSyntaxTheme ?? current.diffSyntaxTheme,
    syntaxThemeSelections: partial.syntaxThemeSelections ?? current.syntaxThemeSelections,
    diffView: partial.diffView ?? current.diffView,
    diffWrapLines: partial.diffWrapLines ?? current.diffWrapLines,
    appearancePreferences: partial.appearancePreferences ?? current.appearancePreferences,
  }
}

function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  return {
    ...mergeGeneralSettings(current, partial),
    ...mergeSessionHostSettings(current, partial),
    ...mergeAppearanceSettings(current, partial),
  }
}

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    favoriteModels: [...settings.favoriteModels],
    enabledModels: [...settings.enabledModels],
    recentProjects: [...settings.recentProjects],
    skillTogglesByProject: { ...settings.skillTogglesByProject },
    projectDisplayNames: { ...settings.projectDisplayNames },
    shortcutBindings: { ...settings.shortcutBindings },
    sessionHostParentConcurrencyLimitsByProject: {
      ...settings.sessionHostParentConcurrencyLimitsByProject,
    },
    multiAgentEnabledByProject: { ...settings.multiAgentEnabledByProject },
    syntaxThemeSelections: { ...settings.syntaxThemeSelections },
    appearancePreferences: {
      ...settings.appearancePreferences,
      typography: { ...settings.appearancePreferences.typography },
    },
  }
}

export function makeBrokerSettingsLayer(currentProjectPath: string | null) {
  let currentSettings: Settings = {
    ...DEFAULT_SETTINGS,
    projectPath: currentProjectPath,
  }

  return Layer.succeed(SettingsService, {
    get: () => Effect.sync(() => cloneSettings(currentSettings)),
    update: (partial) =>
      Effect.sync(() => {
        currentSettings = mergeSettings(currentSettings, partial)
      }),
    initialize: () => Effect.void,
    flushForTests: () => Effect.void,
  })
}
