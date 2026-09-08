import { DEFAULT_SETTINGS, type Settings } from '@shared/types/settings'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SettingsService } from '../../services/settings-service'

function nextSetting<T>(current: T, partial: T | undefined): T {
  return partial === undefined ? current : partial
}

function mergeGeneralSettings(current: Settings, partial: Partial<Settings>) {
  return {
    selectedModel: nextSetting(current.selectedModel, partial.selectedModel),
    favoriteModels: nextSetting(current.favoriteModels, partial.favoriteModels),
    enabledModels: nextSetting(current.enabledModels, partial.enabledModels),
    projectPath: nextSetting(current.projectPath, partial.projectPath),
    thinkingLevel: nextSetting(current.thinkingLevel, partial.thinkingLevel),
    recentProjects: nextSetting(current.recentProjects, partial.recentProjects),
    skillTogglesByProject: nextSetting(
      current.skillTogglesByProject,
      partial.skillTogglesByProject,
    ),
    projectDisplayNames: nextSetting(current.projectDisplayNames, partial.projectDisplayNames),
    defaultAuthorizationMode: nextSetting(
      current.defaultAuthorizationMode,
      partial.defaultAuthorizationMode,
    ),
    shortcutRules: nextSetting(current.shortcutRules, partial.shortcutRules),
    shortcutBindings: nextSetting(current.shortcutBindings, partial.shortcutBindings),
    defaultSessionEnvironmentMode: nextSetting(
      current.defaultSessionEnvironmentMode,
      partial.defaultSessionEnvironmentMode,
    ),
    browserLinkTarget: nextSetting(current.browserLinkTarget, partial.browserLinkTarget),
    browserProfiles: nextSetting(current.browserProfiles, partial.browserProfiles),
    browserDefaultProfileId: nextSetting(
      current.browserDefaultProfileId,
      partial.browserDefaultProfileId,
    ),
    browserDefaultViewport: nextSetting(
      current.browserDefaultViewport,
      partial.browserDefaultViewport,
    ),
    browserDefaultZoomFactor: nextSetting(
      current.browserDefaultZoomFactor,
      partial.browserDefaultZoomFactor,
    ),
    browserDefaultAppearance: nextSetting(
      current.browserDefaultAppearance,
      partial.browserDefaultAppearance,
    ),
    browserRecordingFrameRate: nextSetting(
      current.browserRecordingFrameRate,
      partial.browserRecordingFrameRate,
    ),
    browserAutoShowFloatingPreview: nextSetting(
      current.browserAutoShowFloatingPreview,
      partial.browserAutoShowFloatingPreview,
    ),
    enableAgentBrowserAccess: nextSetting(
      current.enableAgentBrowserAccess,
      partial.enableAgentBrowserAccess,
    ),
  }
}

function mergeAppearanceSettings(current: Settings, partial: Partial<Settings>) {
  return {
    diffSyntaxTheme: nextSetting(current.diffSyntaxTheme, partial.diffSyntaxTheme),
    syntaxThemeSelections: nextSetting(
      current.syntaxThemeSelections,
      partial.syntaxThemeSelections,
    ),
    diffView: nextSetting(current.diffView, partial.diffView),
    diffWrapLines: nextSetting(current.diffWrapLines, partial.diffWrapLines),
    appearancePreferences: nextSetting(
      current.appearancePreferences,
      partial.appearancePreferences,
    ),
  }
}

function mergeSettings(current: Settings, partial: Partial<Settings>): Settings {
  return {
    ...mergeGeneralSettings(current, partial),
    ...mergeAppearanceSettings(current, partial),
  }
}

function cloneSettings(settings: Settings): Settings {
  return {
    ...settings,
    favoriteModels: [...settings.favoriteModels],
    enabledModels: [...settings.enabledModels],
    recentProjects: [...settings.recentProjects],
    browserProfiles: settings.browserProfiles.map((profile) => ({ ...profile })),
    skillTogglesByProject: { ...settings.skillTogglesByProject },
    projectDisplayNames: { ...settings.projectDisplayNames },
    shortcutRules: settings.shortcutRules.map((rule) => ({
      ...rule,
      shortcut: { ...rule.shortcut },
    })),
    shortcutBindings: { ...settings.shortcutBindings },
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
