import type { OPENWAGGLE_EXTENSION } from './constants.js'
import type {
  ExtensionContributionRegistration,
  ExtensionContributionUnregistration,
} from './generated/manifest.js'

export type {
  ExtensionCapabilityScope,
  ExtensionContributionFamily,
  ExtensionContributionMatchView,
  ExtensionContributionRuntime,
  ExtensionContributionTargetView,
  ExtensionExecutionPlacement,
  ExtensionInstallSource,
} from './generated/manifest.js'

type ConstantValue<TObject> = TObject[keyof TObject]

export type ExtensionNetworkAccessMode = ConstantValue<
  typeof OPENWAGGLE_EXTENSION.NETWORK_ACCESS_MODE
>

export type ExtensionRuntimeRegisterContributionPayload = ExtensionContributionRegistration
export type ExtensionRuntimeUnregisterContributionPayload = ExtensionContributionUnregistration
