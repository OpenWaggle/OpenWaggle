import type {
  extensionStorageDeleteResultSchema,
  extensionStorageGetResultSchema,
  extensionStorageKindSchema,
  extensionStorageListResultSchema,
  extensionStorageScopeSchema,
  extensionStorageScopeSelectorSchema,
  extensionStorageSetResultSchema,
} from './broker-schemas-storage.js'
import type { SchemaType } from './schema.js'

export type ExtensionStorageKind = SchemaType<typeof extensionStorageKindSchema>
export type ExtensionStorageScopeSelector = SchemaType<typeof extensionStorageScopeSelectorSchema>
export type ExtensionStorageScope = SchemaType<typeof extensionStorageScopeSchema>
export type ExtensionStorageGetResult = SchemaType<typeof extensionStorageGetResultSchema>
export type ExtensionStorageSetResult = SchemaType<typeof extensionStorageSetResultSchema>
export type ExtensionStorageDeleteResult = SchemaType<typeof extensionStorageDeleteResultSchema>
export type ExtensionStorageListResult = SchemaType<typeof extensionStorageListResultSchema>
/** The fields every storage result carries. */
export type ExtensionStorageResultBase = Pick<
  ExtensionStorageGetResult,
  'extensionId' | 'contributionId' | 'capability' | 'storageKind' | 'storageScope'
>
