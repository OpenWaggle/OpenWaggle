import { OPENWAGGLE_EXTENSION_BROKER } from '@shared/constants/extension-broker'
import {
  extensionRuntimeRegisterContributionResultSchema,
  extensionRuntimeUnregisterContributionResultSchema,
} from '@shared/schemas/extension-broker'
import type {
  ExtensionInvokeFailure,
  ExtensionInvokeResult,
  ExtensionInvokeScope,
  ExtensionRuntimeRegisterContributionPayload,
  ExtensionRuntimeRegisterContributionResult,
  ExtensionRuntimeUnregisterContributionPayload,
  ExtensionRuntimeUnregisterContributionResult,
} from '@shared/types/extension-broker'
import type { ExtensionOperationSuccess, ExtensionSdkInvoke } from './extension-sdk-core'
import {
  decodeWithSchema,
  openWaggleResultError,
  toDecodedOperationResult,
} from './extension-sdk-openwaggle-results'

export interface ExtensionRuntimeContributionSdk {
  readonly registerContribution: (
    scope: ExtensionInvokeScope,
    registration: ExtensionRuntimeRegisterContributionPayload,
  ) => Promise<ExtensionRuntimeRegisterContributionOperationResult>
  readonly unregisterContribution: (
    scope: ExtensionInvokeScope,
    unregistration: ExtensionRuntimeUnregisterContributionPayload,
  ) => Promise<ExtensionRuntimeUnregisterContributionOperationResult>
}

export type ExtensionRuntimeRegisterContributionOperationResult =
  | ExtensionOperationSuccess<ExtensionRuntimeRegisterContributionResult>
  | ExtensionInvokeFailure

export type ExtensionRuntimeUnregisterContributionOperationResult =
  | ExtensionOperationSuccess<ExtensionRuntimeUnregisterContributionResult>
  | ExtensionInvokeFailure

const runtimeContributionResultError = openWaggleResultError(
  'Extension broker returned an invalid runtime contribution result.',
)

function toRuntimeRegisterContributionResult(
  result: ExtensionInvokeResult,
): ExtensionRuntimeRegisterContributionOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionRuntimeRegisterContributionResultSchema),
    runtimeContributionResultError,
  )
}

function toRuntimeUnregisterContributionResult(
  result: ExtensionInvokeResult,
): ExtensionRuntimeUnregisterContributionOperationResult {
  return toDecodedOperationResult(
    result,
    decodeWithSchema(extensionRuntimeUnregisterContributionResultSchema),
    runtimeContributionResultError,
  )
}

export function createRuntimeContributionSdk(
  invoke: ExtensionSdkInvoke,
): ExtensionRuntimeContributionSdk {
  return {
    registerContribution: async (scope, registration) =>
      toRuntimeRegisterContributionResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
          scope,
          payload: registration,
        }),
      ),
    unregisterContribution: async (scope, unregistration) =>
      toRuntimeUnregisterContributionResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
          scope,
          payload: unregistration,
        }),
      ),
  }
}
