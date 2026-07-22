import {
  isStorageDeleteResult,
  isStorageGetResult,
  isStorageListResult,
  isStorageSetResult,
  toDecodedOperationResult,
} from './broker-validation.js'
import { OPENWAGGLE_EXTENSION, OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { JsonValue } from './json.js'
import type {
  ExtensionPackageStorageKindSdk,
  ExtensionPackageStorageSdk,
  ExtensionSdkInvoke,
  ExtensionStorageScopeSdk,
} from './sdk-types.js'
import type {
  ExtensionStorageDeleteResult,
  ExtensionStorageGetResult,
  ExtensionStorageKind,
  ExtensionStorageListResult,
  ExtensionStorageScopeSelector,
  ExtensionStorageSetResult,
} from './types.js'

const STORAGE_RESULT_ERROR = 'Extension broker returned an invalid storage result.'

function storagePayload(
  storageKind: ExtensionStorageKind,
  storageScope: ExtensionStorageScopeSelector,
  key?: string,
  value?: JsonValue,
) {
  return {
    storageKind,
    storageScope,
    ...(key !== undefined ? { key } : {}),
    ...(value !== undefined ? { value } : {}),
  }
}

function createStorageScopeSdk(
  invoke: ExtensionSdkInvoke,
  storageKind: ExtensionStorageKind,
  storageScope: ExtensionStorageScopeSelector,
): ExtensionStorageScopeSdk {
  return {
    get: async (scope, key) =>
      toDecodedOperationResult<ExtensionStorageGetResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.GET,
          scope,
          payload: storagePayload(storageKind, storageScope, key),
        }),
        isStorageGetResult,
        STORAGE_RESULT_ERROR,
      ),
    set: async (scope, key, value) =>
      toDecodedOperationResult<ExtensionStorageSetResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.SET,
          scope,
          payload: storagePayload(storageKind, storageScope, key, value),
        }),
        isStorageSetResult,
        STORAGE_RESULT_ERROR,
      ),
    delete: async (scope, key) =>
      toDecodedOperationResult<ExtensionStorageDeleteResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.DELETE,
          scope,
          payload: storagePayload(storageKind, storageScope, key),
        }),
        isStorageDeleteResult,
        STORAGE_RESULT_ERROR,
      ),
    list: async (scope) =>
      toDecodedOperationResult<ExtensionStorageListResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.STORAGE,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.LIST,
          scope,
          payload: storagePayload(storageKind, storageScope),
        }),
        isStorageListResult,
        STORAGE_RESULT_ERROR,
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
