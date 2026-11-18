// Generated from src/internal/type-sources/storage.ts by scripts/generate-extension-sdk-types.ts;
// do not edit. Regenerate with `bun run extension-sdk-types:generate`; the
// `extension-sdk-types` check step fails when this file no longer matches the schemas.

import type { JsonValue } from '../json.js'

/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = 'config' | 'state'

/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = 'global' | 'project'

/** The storage scope a result belongs to. */
export type ExtensionStorageScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly projectPath: string }

export type ExtensionStorageGetResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.storage'
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
  readonly method: 'get'
  readonly key: string
  readonly value: JsonValue
}

export type ExtensionStorageSetResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.storage'
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
  readonly method: 'set'
  readonly key: string
  readonly value: JsonValue
  readonly createdAt: number
  readonly updatedAt: number
}

export type ExtensionStorageDeleteResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.storage'
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
  readonly method: 'delete'
  readonly key: string
  readonly deleted: true
}

export type ExtensionStorageListResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.storage'
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
  readonly method: 'list'
  readonly keys: readonly string[]
}

export type ExtensionRuntimeRegisterContributionResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.runtime'
  readonly family:
    | 'commands'
    | 'customMessageRenderers'
    | 'dialogs'
    | 'interactionRenderers'
    | 'routes'
    | 'sessionSummarySections'
    | 'settingsSections'
    | 'sidePanels'
    | 'slashCommands'
    | 'statusWidgets'
    | 'toolRenderers'
    | 'transcriptRenderers'
  readonly method: 'register-contribution'
  readonly registeredContributionId: string
}

export type ExtensionRuntimeUnregisterContributionResult = {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: 'openwaggle.runtime'
  readonly family:
    | 'commands'
    | 'customMessageRenderers'
    | 'dialogs'
    | 'interactionRenderers'
    | 'routes'
    | 'sessionSummarySections'
    | 'settingsSections'
    | 'sidePanels'
    | 'slashCommands'
    | 'statusWidgets'
    | 'toolRenderers'
    | 'transcriptRenderers'
  readonly method: 'unregister-contribution'
  readonly unregisteredContributionId: string
  readonly unregistered: boolean
}
