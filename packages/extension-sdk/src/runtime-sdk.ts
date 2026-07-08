import { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionRuntimeContributionSdk, ExtensionSdkInvoke } from './sdk-types.js'
import type {
  ExtensionRuntimeRegisterContributionResult,
  ExtensionRuntimeUnregisterContributionResult,
} from './types.js'

export function createRuntimeContributionSdk(
  invoke: ExtensionSdkInvoke,
): ExtensionRuntimeContributionSdk {
  return {
    registerContribution: (scope, registration) =>
      invoke<ExtensionRuntimeRegisterContributionResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION,
        scope,
        payload: registration,
      }),
    unregisterContribution: (scope, unregistration) =>
      invoke<ExtensionRuntimeUnregisterContributionResult>({
        capability: OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME,
        method: OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION,
        scope,
        payload: unregistration,
      }),
  }
}
