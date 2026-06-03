import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import type {
  ExtensionInvokeInput,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
} from '@shared/types/extension-broker'

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
}

export type ExtensionBrokerTransport = (
  input: ExtensionInvokeInput,
) => Promise<ExtensionInvokeResult>

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
  }
}
