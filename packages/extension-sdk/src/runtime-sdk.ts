import {
  isRuntimeRegisterContributionResult,
  isRuntimeUnregisterContributionResult,
  toDecodedOperationResult,
} from './broker-validation.js'
import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionRuntimeContributionSdk, ExtensionSdkInvoke } from './sdk-types.js'
import type {
  ExtensionRuntimeRegisterContributionResult,
  ExtensionRuntimeUnregisterContributionResult,
} from './types.js'

const RUNTIME_CONTRIBUTION_RESULT_ERROR =
  'Extension broker returned an invalid runtime contribution result.'

export function createRuntimeContributionSdk(
  invoke: ExtensionSdkInvoke,
): ExtensionRuntimeContributionSdk {
  return {
    registerContribution: async (scope, registration) =>
      toDecodedOperationResult<ExtensionRuntimeRegisterContributionResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
          scope,
          payload: registration,
        }),
        isRuntimeRegisterContributionResult,
        RUNTIME_CONTRIBUTION_RESULT_ERROR,
      ),
    unregisterContribution: async (scope, unregistration) =>
      toDecodedOperationResult<ExtensionRuntimeUnregisterContributionResult>(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
          scope,
          payload: unregistration,
        }),
        isRuntimeUnregisterContributionResult,
        RUNTIME_CONTRIBUTION_RESULT_ERROR,
      ),
  }
}
