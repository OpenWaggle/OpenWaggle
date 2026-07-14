import type { OPENWAGGLE_EXTENSION_BROKER } from './constants.js'
import type { ExtensionContributionFamily } from './contribution-types.js'

export interface ExtensionRuntimeRegisterContributionResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.REGISTER_CONTRIBUTION
  readonly family: ExtensionContributionFamily
  readonly registeredContributionId: string
}

export interface ExtensionRuntimeUnregisterContributionResult {
  readonly extensionId: string
  readonly contributionId: string
  readonly capability: typeof OPENWAGGLE_EXTENSION_BROKER.CAPABILITY.RUNTIME
  readonly method: typeof OPENWAGGLE_EXTENSION_BROKER.METHOD.UNREGISTER_CONTRIBUTION
  readonly family: ExtensionContributionFamily
  readonly unregisteredContributionId: string
  readonly unregistered: boolean
}
