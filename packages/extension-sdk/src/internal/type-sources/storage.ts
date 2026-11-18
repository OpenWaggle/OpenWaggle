/**
 * The storage and runtime contribution result types, each inferred from its internal schema and
 * printed into `src/generated/storage.ts` by `scripts/generate-extension-sdk-types.ts`.
 */
import type * as Storage from '../broker-schemas-storage.js'
import type { SchemaType } from '../schema.js'

/** Which package store a call uses: package state or package configuration. */
export type ExtensionStorageKind = SchemaType<typeof Storage.extensionStorageKindSchema>
/** Which storage scope a call reads or writes. */
export type ExtensionStorageScopeSelector = SchemaType<
  typeof Storage.extensionStorageScopeSelectorSchema
>
/** The storage scope a result belongs to. */
export type ExtensionStorageScope = SchemaType<typeof Storage.extensionStorageScopeSchema>
export type ExtensionStorageGetResult = SchemaType<typeof Storage.extensionStorageGetResultSchema>
export type ExtensionStorageSetResult = SchemaType<typeof Storage.extensionStorageSetResultSchema>
export type ExtensionStorageDeleteResult = SchemaType<
  typeof Storage.extensionStorageDeleteResultSchema
>
export type ExtensionStorageListResult = SchemaType<typeof Storage.extensionStorageListResultSchema>
export type ExtensionRuntimeRegisterContributionResult = SchemaType<
  typeof Storage.extensionRuntimeRegisterContributionResultSchema
>
export type ExtensionRuntimeUnregisterContributionResult = SchemaType<
  typeof Storage.extensionRuntimeUnregisterContributionResultSchema
>
