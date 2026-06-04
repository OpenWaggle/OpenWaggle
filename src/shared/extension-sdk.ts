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
  ExtensionCapabilityAuditEntry,
  ExtensionInvokeFailure,
  ExtensionInvokeInput,
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

export interface ExtensionSdkIdentity {
  readonly extensionId: string
  readonly contributionId: string
}

export interface ExtensionSdkInvokeRequest {
  readonly capability: string
  readonly method: string
  readonly scope: ExtensionInvokeScope
  readonly payload?: unknown
}

export interface ExtensionBrokerSdk {
  readonly invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>
  readonly hostContext: {
    readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>
  }
  readonly storage: ExtensionPackageStorageSdk
}

export type ExtensionBrokerTransport = (
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult>

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
  | ExtensionStorageOperationSuccess<ExtensionStorageGetResult>
  | ExtensionInvokeFailure

export type ExtensionStorageSetOperationResult =
  | ExtensionStorageOperationSuccess<ExtensionStorageSetResult>
  | ExtensionInvokeFailure

export type ExtensionStorageDeleteOperationResult =
  | ExtensionStorageOperationSuccess<ExtensionStorageDeleteResult>
  | ExtensionInvokeFailure

export type ExtensionStorageListOperationResult =
  | ExtensionStorageOperationSuccess<ExtensionStorageListResult>
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

interface ExtensionStorageOperationSuccess<TValue> {
  readonly ok: true
  readonly value: TValue
  readonly audit: ExtensionCapabilityAuditEntry
}

function toInvokeInput(
  identity: ExtensionSdkIdentity,
  request: ExtensionSdkInvokeRequest,
): ExtensionInvokeInput {
  return {
    extensionId: identity.extensionId,
    contributionId: identity.contributionId,
    capability: request.capability,
    method: request.method,
    scope: request.scope,
    ...(request.payload !== undefined ? { payload: request.payload } : {}),
  }
}

function invalidStorageResult(input: {
  readonly audit: ExtensionCapabilityAuditEntry
  readonly issues: readonly string[]
}): ExtensionInvokeFailure {
  return {
    ok: false,
    error: {
      code: OPENWAGGLE_EXTENSION_BROKER.FAILURE_CODE.INVALID_PAYLOAD,
      message: 'Extension broker returned an invalid storage result.',
      issues: [...input.issues],
    },
    audit: input.audit,
  }
}

function toStorageGetOperationResult(
  result: ExtensionInvokeResult,
): ExtensionStorageGetOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageGetResultSchema, result.value)
  if (!decoded.success) {
    return invalidStorageResult({ audit: result.audit, issues: decoded.issues })
  }

  return { ok: true, value: decoded.data, audit: result.audit }
}

function toStorageSetOperationResult(
  result: ExtensionInvokeResult,
): ExtensionStorageSetOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageSetResultSchema, result.value)
  if (!decoded.success) {
    return invalidStorageResult({ audit: result.audit, issues: decoded.issues })
  }

  return { ok: true, value: decoded.data, audit: result.audit }
}

function toStorageDeleteOperationResult(
  result: ExtensionInvokeResult,
): ExtensionStorageDeleteOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageDeleteResultSchema, result.value)
  if (!decoded.success) {
    return invalidStorageResult({ audit: result.audit, issues: decoded.issues })
  }

  return { ok: true, value: decoded.data, audit: result.audit }
}

function toStorageListOperationResult(
  result: ExtensionInvokeResult,
): ExtensionStorageListOperationResult {
  if (!result.ok) {
    return result
  }

  const decoded = safeDecodeUnknown(extensionStorageListResultSchema, result.value)
  if (!decoded.success) {
    return invalidStorageResult({ audit: result.audit, issues: decoded.issues })
  }

  return { ok: true, value: decoded.data, audit: result.audit }
}

function createExtensionStorageScopeSdk(
  invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
  storageKind: ExtensionStorageKind,
  storageScope: ExtensionStorageScopeSelector,
): ExtensionStorageScopeSdk {
  return {
    get: async (scope, key) =>
      toStorageGetOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
          scope,
          payload: { storageKind, storageScope, key },
        }),
      ),
    set: async (scope, key, value) =>
      toStorageSetOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
          scope,
          payload: { storageKind, storageScope, key, value },
        }),
      ),
    delete: async (scope, key) =>
      toStorageDeleteOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
          scope,
          payload: { storageKind, storageScope, key },
        }),
      ),
    list: async (scope) =>
      toStorageListOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
          scope,
          payload: { storageKind, storageScope },
        }),
      ),
  }
}

function createExtensionStorageKindSdk(
  invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
  storageKind: ExtensionStorageKind,
): ExtensionPackageStorageKindSdk {
  return {
    global: createExtensionStorageScopeSdk(
      invoke,
      storageKind,
      OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND,
    ),
    project: createExtensionStorageScopeSdk(
      invoke,
      storageKind,
      OPENWAGGLE_EXTENSION.STORAGE.SCOPE.PROJECT_KIND,
    ),
  }
}

function createExtensionPackageStorageSdk(
  invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
): ExtensionPackageStorageSdk {
  return {
    packageState: createExtensionStorageKindSdk(invoke, OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE),
    packageConfig: createExtensionStorageKindSdk(invoke, OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG),
  }
}

export function createExtensionBrokerSdk(
  transport: ExtensionBrokerTransport,
  identity: ExtensionSdkIdentity,
): ExtensionBrokerSdk {
  const invoke = (request: ExtensionSdkInvokeRequest) => transport(toInvokeInput(identity, request))

  return {
    invoke,
    hostContext: {
      getScope: (scope) =>
        invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.HOST_CONTEXT,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET_SCOPE,
          scope,
          payload: {},
        }),
    },
    storage: createExtensionPackageStorageSdk(invoke),
  }
}
