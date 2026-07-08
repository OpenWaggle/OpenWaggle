import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionInvokeScope, ExtensionStateSelector } from './core-types.js'

export interface ExtensionModelPrefs {
  readonly selectedModel: string
  readonly favoriteModels: readonly string[]
  readonly enabledModels: readonly string[]
  readonly thinkingLevel: string
}

export interface ExtensionProjectView {
  readonly projectPath: string
  readonly displayName: string | null
  readonly active: boolean
}

export interface ExtensionSessionView {
  readonly sessionId: string
  readonly title: string
  readonly projectPath: string | null
}

export interface ExtensionBranchView {
  readonly branchId: string
  readonly sessionId: string
  readonly name: string
  readonly main: boolean
  readonly archived: boolean
}

export interface ExtensionStateReadResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_STATE
  readonly scope: ExtensionInvokeScope
  readonly activeProjectPath: string | null
  readonly currentProject: ExtensionProjectView | null
  readonly currentSession: ExtensionSessionView | null
  readonly currentBranch: ExtensionBranchView | null
  readonly recentProjects: readonly string[]
  readonly modelPreferences: ExtensionModelPrefs
}

export interface ExtensionSelectedStateReadResult<TValue> {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STATE
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.READ_STATE
  readonly scope: ExtensionInvokeScope
  readonly selector: ExtensionStateSelector
  readonly value: TValue
}

export type ExtensionStateCurrentProjectReadResult =
  ExtensionSelectedStateReadResult<ExtensionProjectView | null>
export type ExtensionStateCurrentSessionReadResult =
  ExtensionSelectedStateReadResult<ExtensionSessionView | null>
export type ExtensionStateCurrentBranchReadResult =
  ExtensionSelectedStateReadResult<ExtensionBranchView | null>
export type ExtensionStateRecentProjectsReadResult = ExtensionSelectedStateReadResult<
  readonly string[]
>
export type ExtensionStateModelPreferencesReadResult =
  ExtensionSelectedStateReadResult<ExtensionModelPrefs>

export interface ExtensionActionSelectProjectResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.ACTIONS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SELECT_PROJECT
  readonly previousProjectPath: string | null
  readonly projectPath: string
  readonly recentProjects: readonly string[]
}

export interface ExtensionSettingsView {
  readonly modelPreferences: ExtensionModelPrefs
  readonly projectDisplayNames: Readonly<Record<string, string>>
}

export interface ExtensionModelPreferencesSettingsPatch {
  readonly selectedModel?: string
  readonly favoriteModels?: readonly string[]
  readonly enabledModels?: readonly string[]
  readonly thinkingLevel?: string
}

export type ExtensionSettingsUpdatePayload = ExtensionModelPreferencesSettingsPatch & {
  readonly projectDisplayNames?: Readonly<Record<string, string>>
}

export interface ExtensionSettingsGetResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTINGS
  readonly settings: ExtensionSettingsView
}

export interface ExtensionSettingsUpdateResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTINGS
  readonly settings: ExtensionSettingsView
}

export type ExtensionSettingsSelectedValue =
  | {
      readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.MODEL_PREFERENCES
      readonly value: ExtensionModelPrefs
    }
  | {
      readonly key: typeof OPENWAGGLE_EXTENSION_BROKER.SETTING_KEY.PROJECT_DISPLAY_NAME
      readonly projectPath: string
      readonly value: string | null
    }

export interface ExtensionSettingsGetSettingResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SETTING
  readonly setting: ExtensionSettingsSelectedValue
}

export interface ExtensionSettingsUpdateSettingResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.SETTINGS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UPDATE_SETTING
  readonly setting: ExtensionSettingsSelectedValue
}

export interface ExtensionDocsDiscoverPayload {
  readonly projectPaths?: readonly string[]
  readonly includeExtensions?: boolean
}

export interface ExtensionDocsResolveTopicPayload {
  readonly topic: string
}

export interface ExtensionDocsDiscoverResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DISCOVER_DOCS
  readonly docs: unknown
}

export interface ExtensionDocsResolveTopicResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.DOCS
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.RESOLVE_DOCS_TOPIC
  readonly resolvedTopic: unknown
}
