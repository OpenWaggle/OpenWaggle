// Generated from src/internal/type-sources/openwaggle.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

import type { ExtensionInvokeScope } from './broker.js'

export type ExtensionModelPrefs = {
  readonly selectedModel: string
  readonly favoriteModels: readonly string[]
  readonly enabledModels: readonly string[]
  readonly thinkingLevel: string
}

export type ExtensionProjectView = {
  readonly projectPath: string
  readonly displayName: string | null
  readonly active: boolean
}

export type ExtensionSessionView = {
  readonly sessionId: string
  readonly title: string
  readonly projectPath: string | null
}

export type ExtensionBranchView = {
  readonly branchId: string
  readonly sessionId: string
  readonly name: string
  readonly main: boolean
  readonly archived: boolean
}

export type ExtensionStateReadResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.state'
  readonly method: 'get-state'
  readonly scope: ExtensionInvokeScope
  readonly activeProjectPath: string | null
  readonly currentProject: ExtensionProjectView | null
  readonly currentSession: ExtensionSessionView | null
  readonly currentBranch: ExtensionBranchView | null
  readonly recentProjects: readonly string[]
  readonly modelPreferences: ExtensionModelPrefs
}

export type ExtensionStateCurrentProjectReadResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.state'
  readonly method: 'read-state'
  readonly scope: ExtensionInvokeScope
  readonly selector:
    | 'current-branch'
    | 'current-project'
    | 'current-session'
    | 'model-preferences'
    | 'recent-projects'
  readonly value: {
    readonly active: boolean
    readonly displayName: string | null
    readonly projectPath: string
  } | null
}

export type ExtensionStateCurrentSessionReadResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.state'
  readonly method: 'read-state'
  readonly scope: ExtensionInvokeScope
  readonly selector:
    | 'current-branch'
    | 'current-project'
    | 'current-session'
    | 'model-preferences'
    | 'recent-projects'
  readonly value: {
    readonly projectPath: string | null
    readonly sessionId: string
    readonly title: string
  } | null
}

export type ExtensionStateCurrentBranchReadResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.state'
  readonly method: 'read-state'
  readonly scope: ExtensionInvokeScope
  readonly selector:
    | 'current-branch'
    | 'current-project'
    | 'current-session'
    | 'model-preferences'
    | 'recent-projects'
  readonly value: {
    readonly archived: boolean
    readonly branchId: string
    readonly main: boolean
    readonly name: string
    readonly sessionId: string
  } | null
}

export type ExtensionStateRecentProjectsReadResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.state'
  readonly method: 'read-state'
  readonly scope: ExtensionInvokeScope
  readonly selector:
    | 'current-branch'
    | 'current-project'
    | 'current-session'
    | 'model-preferences'
    | 'recent-projects'
  readonly value: readonly string[]
}

export type ExtensionStateModelPreferencesReadResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.state'
  readonly method: 'read-state'
  readonly scope: ExtensionInvokeScope
  readonly selector:
    | 'current-branch'
    | 'current-project'
    | 'current-session'
    | 'model-preferences'
    | 'recent-projects'
  readonly value: {
    readonly enabledModels: readonly string[]
    readonly favoriteModels: readonly string[]
    readonly selectedModel: string
    readonly thinkingLevel: string
  }
}

export type ExtensionActionSelectProjectResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.actions'
  readonly method: 'select-project'
  readonly previousProjectPath: string | null
  readonly projectPath: string
  readonly recentProjects: readonly string[]
}

export type ExtensionSessionResourceKind =
  | 'change-request'
  | 'commit'
  | 'file'
  | 'image'
  | 'link'
  | 'site'
  | 'tool'
  | 'web-search'

export type ExtensionSessionResourceRole = 'output' | 'source'

export type ExtensionSessionResourceView = {
  readonly id: string
  readonly title: string
  readonly kind: ExtensionSessionResourceKind
  readonly mimeType: string | null
  readonly available: boolean
  readonly isSource: boolean
  readonly isOutput: boolean
}

export type ExtensionSessionResourcePublishPayload = {
  readonly key: string
  readonly title: string
  readonly kind: 'image' | 'link'
  readonly role: ExtensionSessionResourceRole
  readonly locator: string
}

export type ExtensionSessionResourcesListPayload = {
  readonly cursor?: string | null
  readonly limit?: number
}

export type ExtensionSessionResourcesListResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.resources'
  readonly sessionId: string
  readonly method: 'list-resources'
  readonly resources: readonly ExtensionSessionResourceView[]
  readonly total: number
  readonly nextCursor: string | null
}

export type ExtensionSessionResourcePublishResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.resources'
  readonly sessionId: string
  readonly method: 'publish-resource'
  readonly resource: ExtensionSessionResourceView
}

export type ExtensionSettingsView = {
  readonly modelPreferences: ExtensionModelPrefs
  readonly projectDisplayNames: Readonly<Record<string, string>>
}

export type ExtensionModelPreferencesSettingsPatch = {
  readonly selectedModel?: string
  readonly favoriteModels?: readonly string[]
  readonly enabledModels?: readonly string[]
  /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
  readonly thinkingLevel?: string
}

export type ExtensionSettingsUpdatePayload = {
  readonly selectedModel?: string
  readonly favoriteModels?: readonly string[]
  readonly enabledModels?: readonly string[]
  /** Accepted for SDK compatibility and ignored: extensions cannot change the thinking level. */
  readonly thinkingLevel?: string
  readonly projectDisplayNames?: Readonly<Record<string, string>>
}

export type ExtensionSettingsGetResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.settings'
  readonly method: 'get-settings'
  readonly settings: ExtensionSettingsView
}

export type ExtensionSettingsUpdateResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.settings'
  readonly method: 'update-settings'
  readonly settings: ExtensionSettingsView
}

export type ExtensionSettingsSelectedValue =
  | { readonly key: 'model-preferences'; readonly value: ExtensionModelPrefs }
  | {
      readonly key: 'project-display-name'
      readonly projectPath: string
      readonly value: string | null
    }

export type ExtensionSettingsGetSettingResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.settings'
  readonly method: 'get-setting'
  readonly setting: ExtensionSettingsSelectedValue
}

export type ExtensionSettingsUpdateSettingResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.settings'
  readonly method: 'update-setting'
  readonly setting: ExtensionSettingsSelectedValue
}
