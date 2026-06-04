import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import { OPENWAGGLE_EXTENSION } from '@shared/constants/extensions'
import type {
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionStorageKind,
  ExtensionStorageScopeSelector,
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
  readonly storage: {
    readonly state: ExtensionStorageKindSdk
    readonly config: ExtensionStorageKindSdk
  }
}

export type ExtensionBrokerTransport = (
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult>

export interface ExtensionStorageOperationOptions {
  readonly storageScope?: ExtensionStorageScopeSelector
}

export interface ExtensionStorageKindSdk {
  readonly get: (
    scope: ExtensionInvokeScope,
    key: string,
    options?: ExtensionStorageOperationOptions,
  ) => Promise<ExtensionInvokeResult>
  readonly set: (
    scope: ExtensionInvokeScope,
    key: string,
    value: JsonValue,
    options?: ExtensionStorageOperationOptions,
  ) => Promise<ExtensionInvokeResult>
  readonly delete: (
    scope: ExtensionInvokeScope,
    key: string,
    options?: ExtensionStorageOperationOptions,
  ) => Promise<ExtensionInvokeResult>
  readonly list: (
    scope: ExtensionInvokeScope,
    options?: ExtensionStorageOperationOptions,
  ) => Promise<ExtensionInvokeResult>
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

function storageScope(options: ExtensionStorageOperationOptions | undefined) {
  return options?.storageScope ?? OPENWAGGLE_EXTENSION.STORAGE.SCOPE.GLOBAL_KIND
}

function createExtensionStorageKindSdk(
  invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>,
  storageKind: ExtensionStorageKind,
): ExtensionStorageKindSdk {
  return {
    get: (scope, key, options) =>
      invoke({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
        scope,
        payload: { storageKind, storageScope: storageScope(options), key },
      }),
    set: (scope, key, value, options) =>
      invoke({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
        scope,
        payload: { storageKind, storageScope: storageScope(options), key, value },
      }),
    delete: (scope, key, options) =>
      invoke({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
        scope,
        payload: { storageKind, storageScope: storageScope(options), key },
      }),
    list: (scope, options) =>
      invoke({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
        scope,
        payload: { storageKind, storageScope: storageScope(options) },
      }),
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
    storage: {
      state: createExtensionStorageKindSdk(invoke, OPENWAGGLE_EXTENSION.STORAGE.KIND.STATE),
      config: createExtensionStorageKindSdk(invoke, OPENWAGGLE_EXTENSION.STORAGE.KIND.CONFIG),
    },
  }
}
