import type { ExtensionStorageGetResult } from './generated/storage.js'

export type {
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageKind,
  ExtensionStorageListResult,
  ExtensionStorageScope,
  ExtensionStorageScopeSelector,
  ExtensionStorageSetResult,
} from './generated/storage.js'

/** The fields every storage result carries. */
export type ExtensionStorageResultBase = Pick<
  ExtensionStorageGetResult,
  'extensionId' | 'contributionId' | 'capability' | 'storageKind' | 'storageScope'
>
