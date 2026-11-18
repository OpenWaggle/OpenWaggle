import {
  runtimeRegisterContributionResultSchema,
  runtimeUnregisterContributionResultSchema,
  toDecodedOperationResult,
} from './broker-validation.js'
import { OPENWAGGLE_EXTENSION_BROKER } from '../constants.js'
import type { ExtensionRuntimeContributionSdk, ExtensionSdkInvoke } from '../sdk-types.js'

const RUNTIME_CONTRIBUTION_RESULT_ERROR =
  'Extension broker returned an invalid runtime contribution result.'

export function createRuntimeContributionSdk(invoke: ExtensionSdkInvoke) {
  const sdk: ExtensionRuntimeContributionSdk = {
    registerContribution: async (scope, registration) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
          scope,
          payload: registration,
        }),
        runtimeRegisterContributionResultSchema,
        RUNTIME_CONTRIBUTION_RESULT_ERROR,
      ),
    unregisterContribution: async (scope, unregistration) =>
      toDecodedOperationResult(
        await invoke({
          capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
          method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
          scope,
          payload: unregistration,
        }),
        runtimeUnregisterContributionResultSchema,
        RUNTIME_CONTRIBUTION_RESULT_ERROR,
      ),
  }
  return sdk
}
