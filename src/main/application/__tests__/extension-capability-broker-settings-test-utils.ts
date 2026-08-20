import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SettingsService } from '../../services/settings-service'

function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  return {
    selectedModel: partial.selectedModel ?? current.selectedModel,
    favoriteModels: partial.favoriteModels ?? current.favoriteModels,
    enabledModels: partial.enabledModels ?? current.enabledModels,
    projectPath: partial.projectPath !== undefined ? partial.projectPath : current.projectPath,
    thinkingLevel: partial.thinkingLevel ?? current.thinkingLevel,
    recentProjects: partial.recentProjects ?? current.recentProjects,
    skillTogglesByProject: partial.skillTogglesByProject ?? current.skillTogglesByProject,
    projectDisplayNames: partial.projectDisplayNames ?? current.projectDisplayNames,
    shortcutBindings: partial.shortcutBindings ?? current.shortcutBindings,
    defaultSessionEnvironmentMode:
      partial.defaultSessionEnvironmentMode ?? current.defaultSessionEnvironmentMode,
    diffSyntaxTheme: partial.diffSyntaxTheme ?? current.diffSyntaxTheme,
    diffView: partial.diffView ?? current.diffView,
    diffWrapLines: partial.diffWrapLines ?? current.diffWrapLines,
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
