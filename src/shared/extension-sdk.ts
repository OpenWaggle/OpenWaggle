import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type { ExtensionInvokeResult, ExtensionInvokeScope } from '@shared/types/extension-broker'
import {
  type ExtensionBrokerTransport,
  type ExtensionSdkIdentity,
  type ExtensionSdkInvokeRequest,
  toInvokeInput,
} from './extension-sdk-core'
import { createOpenWaggleSdk, type ExtensionOpenWaggleSdk } from './extension-sdk-openwaggle'
import { createPackageStorageSdk, type ExtensionPackageStorageSdk } from './extension-sdk-storage'

export type {
  ExtensionBrokerTransport,
  ExtensionOperationSuccess,
  ExtensionSdkIdentity,
  ExtensionSdkInvoke,
  ExtensionSdkInvokeRequest,
} from './extension-sdk-core'
export type {
  ExtensionOpenWaggleSdk,
  ExtensionSelectProjectOperationResult,
  ExtensionSettingsGetOperationResult,
  ExtensionSettingsUpdateOperationResult,
  ExtensionStateReadOperationResult,
} from './extension-sdk-openwaggle'
export type {
  ExtensionPackageStorageKindSdk,
  ExtensionPackageStorageSdk,
  ExtensionStorageDeleteOperationResult,
  ExtensionStorageGetOperationResult,
  ExtensionStorageListOperationResult,
  ExtensionStorageScopeSdk,
  ExtensionStorageSetOperationResult,
} from './extension-sdk-storage'

export interface ExtensionBrokerSdk {
  readonly invoke: (request: ExtensionSdkInvokeRequest) => Promise<ExtensionInvokeResult>
  readonly hostContext: {
    readonly getScope: (scope: ExtensionInvokeScope) => Promise<ExtensionInvokeResult>
  }
  readonly storage: ExtensionPackageStorageSdk
  readonly openWaggle: ExtensionOpenWaggleSdk
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
    storage: createPackageStorageSdk(invoke),
    openWaggle: createOpenWaggleSdk(invoke),
  }
}
