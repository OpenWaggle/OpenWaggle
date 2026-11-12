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

export type * from './core-types.js'
export type * from './sdk-types.js'

// Typed as a value: inferred, the declarations would spell out the schema type that
// `ExtensionInvokeInput` names.
export const toInvokeInput: (
  identity: ExtensionSdkIdentity,
  request: ExtensionSdkInvokeRequest,
) => ExtensionInvokeInput = (identity, request) => ({
  extensionId: identity.extensionId,
  contributionId: identity.contributionId,
  capability: request.capability,
  method: request.method,
  scope: request.scope,
  ...(request.payload !== undefined ? { payload: request.payload } : {}),
})

export function createExtensionBrokerSdkFromInvoke(
  invoke: ExtensionSdkInvoke,
  options: CreateOpenWaggleSdkOptions = {},
) {
  const sdk: ExtensionBrokerSdk = {
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
  return sdk
}

export function createExtensionBrokerSdk(
  transport: ExtensionBrokerTransport,
  identity: ExtensionSdkIdentity,
  options: CreateOpenWaggleSdkOptions = {},
) {
  const invoke: ExtensionSdkInvoke = (request) => transport(toInvokeInput(identity, request))

  return createExtensionBrokerSdkFromInvoke(invoke, options)
}
