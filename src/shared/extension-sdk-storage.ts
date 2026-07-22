import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import { safeDecodeUnknown } from '@shared/schema'
import {
  extensionStorageDeleteResultSchema,
  extensionStorageGetResultSchema,
  extensionStorageListResultSchema,
  extensionStorageSetResultSchema,
} from '@shared/schemas/extension-broker'
import type {
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageKind,
  ExtensionStorageListResult,
  ExtensionStorageScopeSelector,
  ExtensionStorageSetResult,
} from '@shared/types/extension-broker'
import type { JsonValue } from '@shared/types/json'
import type { ExtensionOperationSuccess, ExtensionSdkInvoke } from './extension-sdk-core'
import { invalidOperationResult } from './extension-sdk-core'

export interface ExtensionPackageStorageSdk {
  /**
   * Persistent package state shared by every contribution from the same extension package.
   */
  readonly packageState: ExtensionPackageStorageKindSdk
  /**
   * Persistent package config shared by every contribution from the same extension package.
   */
  readonly packageConfig: ExtensionPackageStorageKindSdk
}

export interface ExtensionPackageStorageKindSdk {
  readonly global: ExtensionStorageScopeSdk
  readonly project: ExtensionStorageScopeSdk
}

export type ExtensionStorageGetOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageGetResult>
  | ExtensionInvokeFailure

export type ExtensionStorageSetOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageSetResult>
  | ExtensionInvokeFailure

export type ExtensionStorageDeleteOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageDeleteResult>
  | ExtensionInvokeFailure

export type ExtensionStorageListOperationResult =
  | ExtensionOperationSuccess<ExtensionStorageListResult>
  | ExtensionInvokeFailure

export interface ExtensionStorageScopeSdk {
  readonly get: (
    scope: ExtensionInvokeScope,
    key: string,
  ) => Promise<ExtensionStorageGetOperationResult>
  readonly set: (
    scope: ExtensionInvokeScope,
    key: string,
    value: JsonValue,
  ) => Promise<ExtensionStorageSetOperationResult>
  readonly delete: (
    scope: ExtensionInvokeScope,
    key: string,
  ) => Promise<ExtensionStorageDeleteOperationResult>
  readonly list: (scope: ExtensionInvokeScope) => Promise<ExtensionStorageListOperationResult>
}

function storageResultError(input: {
  readonly result: ExtensionInvokeResult & { readonly ok: true }
  readonly issues: readonly string[]
}) {
  return invalidOperationResult({
    audit: input.result.audit,
    issues: input.issues,
    message: 'Extension broker returned an invalid storage result.',
  })
}

function toStorageGetResult(result: ExtensionInvokeResult): ExtensionStorageGetOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageGetResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : storageResultError({ result, issues: decoded.issues })
}

function toStorageSetResult(result: ExtensionInvokeResult): ExtensionStorageSetOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageSetResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : storageResultError({ result, issues: decoded.issues })
}

function toStorageDeleteResult(
  result: ExtensionInvokeResult,
): ExtensionStorageDeleteOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageDeleteResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : storageResultError({ result, issues: decoded.issues })
}

function toStorageListResult(result: ExtensionInvokeResult): ExtensionStorageListOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageListResultSchema, result.value)
  return decoded.success
    ? { ok: true, value: decoded.data, audit: result.audit }
    : storageResultError({ result, issues: decoded.issues })
}

function createStorageScopeSdk(
  invoke: ExtensionSdkInvoke,
  storageKind: ExtensionStorageKind,
  storageScope: ExtensionStorageScopeSelector,
): ExtensionStorageScopeSdk {
  return {
    get: async (scope, key) =>
      toStorageGetResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
          scope,
          payload: { storageKind, storageScope, key },
        }),
      ),
    set: async (scope, key, value) =>
      toStorageSetResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
          scope,
          payload: { storageKind, storageScope, key, value },
        }),
      ),
    delete: async (scope, key) =>
      toStorageDeleteResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
          scope,
          payload: { storageKind, storageScope, key },
        }),
      ),
    list: async (scope) =>
      toStorageListResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
          scope,
          payload: { storageKind, storageScope },
        }),
      ),
  }
}

function createStorageKindSdk(
  invoke: ExtensionSdkInvoke,
  storageKind: ExtensionStorageKind,
): ExtensionPackageStorageKindSdk {
  return {
    global: createStorageScopeSdk(
      invoke,
      storageKind,
      OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
    ),
    project: createStorageScopeSdk(
      invoke,
      storageKind,
      OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
    ),
  }
}

export function createPackageStorageSdk(invoke: ExtensionSdkInvoke): ExtensionPackageStorageSdk {
  return {
    packageState: createStorageKindSdk(invoke, OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE),
    packageConfig: createStorageKindSdk(invoke, OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG),
  }
}
