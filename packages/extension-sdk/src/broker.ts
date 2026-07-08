import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import { createOpenWaggleSdk } from './openwaggle-sdk.js'
import { createRuntimeContributionSdk } from './runtime-sdk.js'
import type {
  CreateOpenWaggleSdkOptions,
  ExtensionBrokerSdk,
  ExtensionBrokerTransport,
  ExtensionSdkIdentity,
  ExtensionSdkInvoke,
  ExtensionSdkInvokeRequest,
} from './sdk-types.js'
import { createPackageStorageSdk } from './storage-sdk.js'
import type { ExtensionInvokeInput } from './types.js'

export type * from './sdk-types.js'

export function toInvokeInput(
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

export function createExtensionBrokerSdkFromInvoke(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionBrokerSdk {
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
    openWaggle: createOpenWaggleSdk(invoke, options),
    runtime: createRuntimeContributionSdk(invoke),
  }
}

export function createExtensionBrokerSdk(
  transport: ExtensionBrokerTransport,
  identity: ExtensionSdkIdentity,
  options: CreateOpenWaggleSdkOptions = {},
): ExtensionBrokerSdk {
  const invoke: ExtensionSdkInvoke = (request) => transport(toInvokeInput(identity, request))

  return createExtensionBrokerSdkFromInvoke(invoke, options)
}
