import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SettingsService } from '../../services/settings-service'

function defined<T>(value: T | undefined, fallback: T): T {
  return value === undefined ? fallback : value
}

function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  return {
    selectedModel: defined(partial.selectedModel, current.selectedModel),
    favoriteModels: defined(partial.favoriteModels, current.favoriteModels),
    enabledModels: defined(partial.enabledModels, current.enabledModels),
    projectPath: defined(partial.projectPath, current.projectPath),
    thinkingLevel: defined(partial.thinkingLevel, current.thinkingLevel),
    recentProjects: defined(partial.recentProjects, current.recentProjects),
    skillTogglesByProject: defined(partial.skillTogglesByProject, current.skillTogglesByProject),
    projectDisplayNames: defined(partial.projectDisplayNames, current.projectDisplayNames),
    defaultAuthorizationMode: defined(
      partial.defaultAuthorizationMode,
      current.defaultAuthorizationMode,
    ),
    shortcutBindings: defined(partial.shortcutBindings, current.shortcutBindings),
    defaultSessionEnvironmentMode: defined(
      partial.defaultSessionEnvironmentMode,
      current.defaultSessionEnvironmentMode,
    ),
    diffSyntaxTheme: defined(partial.diffSyntaxTheme, current.diffSyntaxTheme),
    diffView: defined(partial.diffView, current.diffView),
    diffWrapLines: defined(partial.diffWrapLines, current.diffWrapLines),
    sessionHostParentConcurrencyLimit: defined(
      partial.sessionHostParentConcurrencyLimit,
      current.sessionHostParentConcurrencyLimit,
    ),
    sessionHostParentConcurrencyLimitsByProject: defined(
      partial.sessionHostParentConcurrencyLimitsByProject,
      current.sessionHostParentConcurrencyLimitsByProject,
    ),
    sessionHostRunCeiling: defined(partial.sessionHostRunCeiling, current.sessionHostRunCeiling),
    sessionHostIdleGracePeriodMs: defined(
      partial.sessionHostIdleGracePeriodMs,
      current.sessionHostIdleGracePeriodMs,
    ),
    multiAgentEnabled: defined(partial.multiAgentEnabled, current.multiAgentEnabled),
    multiAgentEnabledByProject: defined(
      partial.multiAgentEnabledByProject,
      current.multiAgentEnabledByProject,
    ),
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
