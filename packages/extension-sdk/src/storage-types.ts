import type { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { JsonValue } from './json.js'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionStorageKind = ConstantValue<typeof OPENWAGGLE_EXTENSION.STORAGE.KIND>
export type ExtensionStorageScopeSelector =
  (typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE_KINDS)[number]

export type ExtensionStorageScope =
  | { readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND }
  | {
      readonly kind: typeof OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND
      readonly projectPath: string
    }

export interface ExtensionStorageResultBase {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE
  readonly storageKind: ExtensionStorageKind
  readonly storageScope: ExtensionStorageScope
}

export interface ExtensionStorageGetResult extends ExtensionStorageResultBase {
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.GET
  readonly key: string
  readonly value: JsonValue | null
}

export interface ExtensionStorageSetResult extends ExtensionStorageResultBase {
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.SET
  readonly key: string
  readonly value: JsonValue
  readonly createdAt: number
  readonly updatedAt: number
}

export interface ExtensionStorageDeleteResult extends ExtensionStorageResultBase {
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE
  readonly key: string
  readonly deleted: true
}

export interface ExtensionStorageListResult extends ExtensionStorageResultBase {
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST
  readonly keys: readonly string[]
}
